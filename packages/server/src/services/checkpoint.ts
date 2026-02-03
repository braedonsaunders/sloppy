/**
 * Checkpoint Service for Sloppy
 * Manages git-based checkpoints for session recovery
 */

import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import {
  Checkpoint,
  CheckpointRestoreResult,
  SessionMetrics,
  Logger,
  DatabaseCheckpoint,
} from './types';
import { IssueTracker } from './issue-tracker';

// ============================================================================
// Types
// ============================================================================

export interface CheckpointDatabaseAdapter {
  insertCheckpoint(checkpoint: DatabaseCheckpoint): Promise<void>;
  getCheckpoint(id: string): Promise<DatabaseCheckpoint | null>;
  getCheckpoints(sessionId: string): Promise<DatabaseCheckpoint[]>;
  getLatestCheckpoint(sessionId: string): Promise<DatabaseCheckpoint | null>;
  deleteCheckpoint(id: string): Promise<void>;
  deleteSessionCheckpoints(sessionId: string): Promise<number>;
}

export interface CheckpointServiceConfig {
  repositoryPath: string;
  sessionId: string;
  cleaningBranch: string;
}

interface GitCommandResult {
  success: boolean;
  output: string;
  error?: string;
}

// ============================================================================
// Checkpoint Service Class
// ============================================================================

export class CheckpointService {
  private config: CheckpointServiceConfig;
  private logger: Logger;
  private db: CheckpointDatabaseAdapter;
  private issueTracker: IssueTracker;
  private intervalId: NodeJS.Timeout | null = null;

  constructor(
    config: CheckpointServiceConfig,
    logger: Logger,
    db: CheckpointDatabaseAdapter,
    issueTracker: IssueTracker
  ) {
    this.config = config;
    this.logger = logger;
    this.db = db;
    this.issueTracker = issueTracker;
  }

  /**
   * Create a checkpoint at the current state
   */
  async createCheckpoint(
    description: string,
    metrics?: SessionMetrics | null
  ): Promise<Checkpoint> {
    this.logger.info('Creating checkpoint', { description });

    // Get current commit hash
    const commitHash = await this.getCurrentCommitHash();
    if (!commitHash) {
      throw new Error('Failed to get current commit hash');
    }

    // Get issue progress
    const stats = await this.issueTracker.getStats();

    const checkpoint: Checkpoint = {
      id: randomUUID(),
      sessionId: this.config.sessionId,
      commitHash,
      branch: this.config.cleaningBranch,
      description,
      issueProgress: {
        total: stats.total,
        resolved: stats.resolved,
        failed: stats.failed,
        pending: stats.pending,
      },
      metrics: metrics ?? null,
      createdAt: new Date(),
    };

    // Create a git tag for the checkpoint
    const tagName = this.getTagName(checkpoint.id);
    const tagResult = await this.createGitTag(tagName, description);
    if (!tagResult.success) {
      this.logger.warn('Failed to create git tag for checkpoint', {
        checkpointId: checkpoint.id,
        error: tagResult.error,
      });
      // Continue anyway - we can still restore using commit hash
    }

    // Persist to database
    await this.db.insertCheckpoint(this.toDbCheckpoint(checkpoint));

    this.logger.info('Checkpoint created', {
      checkpointId: checkpoint.id,
      commitHash,
      progress: checkpoint.issueProgress,
    });

    return checkpoint;
  }

  /**
   * Restore from a checkpoint
   */
  async restoreCheckpoint(checkpointId: string): Promise<CheckpointRestoreResult> {
    this.logger.info('Restoring checkpoint', { checkpointId });

    // Get checkpoint from database
    const dbCheckpoint = await this.db.getCheckpoint(checkpointId);
    if (!dbCheckpoint) {
      return {
        success: false,
        checkpoint: {} as Checkpoint,
        error: `Checkpoint not found: ${checkpointId}`,
      };
    }

    const checkpoint = this.fromDbCheckpoint(dbCheckpoint);

    try {
      // Check for uncommitted changes
      const hasChanges = await this.hasUncommittedChanges();
      if (hasChanges) {
        // Stash changes before restoring
        this.logger.info('Stashing uncommitted changes');
        await this.runGitCommand(['stash', 'push', '-m', `sloppy-restore-${checkpointId}`]);
      }

      // Try to checkout using tag first, then commit hash
      const tagName = this.getTagName(checkpointId);
      let checkoutResult = await this.runGitCommand(['checkout', tagName]);

      if (!checkoutResult.success) {
        // Fallback to commit hash
        this.logger.debug('Tag not found, using commit hash', {
          tag: tagName,
          commitHash: checkpoint.commitHash,
        });
        checkoutResult = await this.runGitCommand(['checkout', checkpoint.commitHash]);
      }

      if (!checkoutResult.success) {
        throw new Error(`Failed to checkout: ${checkoutResult.error}`);
      }

      // Create a new branch from the checkpoint
      const newBranch = `${this.config.cleaningBranch}-restored-${Date.now()}`;
      const branchResult = await this.runGitCommand(['checkout', '-b', newBranch]);

      if (!branchResult.success) {
        // If branch creation fails, we're still at the right commit
        this.logger.warn('Failed to create new branch from checkpoint', {
          error: branchResult.error,
        });
      }

      // Reload issues from database
      await this.issueTracker.loadFromDatabase();

      this.logger.info('Checkpoint restored', {
        checkpointId,
        commitHash: checkpoint.commitHash,
        newBranch: branchResult.success ? newBranch : undefined,
      });

      return {
        success: true,
        checkpoint,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('Failed to restore checkpoint', {
        checkpointId,
        error: errorMessage,
      });

      return {
        success: false,
        checkpoint,
        error: errorMessage,
      };
    }
  }

  /**
   * List all checkpoints for the session
   */
  async listCheckpoints(): Promise<Checkpoint[]> {
    const dbCheckpoints = await this.db.getCheckpoints(this.config.sessionId);
    return dbCheckpoints.map((c) => this.fromDbCheckpoint(c));
  }

  /**
   * Get the latest checkpoint
   */
  async getLatestCheckpoint(): Promise<Checkpoint | null> {
    const dbCheckpoint = await this.db.getLatestCheckpoint(this.config.sessionId);
    return dbCheckpoint ? this.fromDbCheckpoint(dbCheckpoint) : null;
  }

  /**
   * Delete a checkpoint
   */
  async deleteCheckpoint(checkpointId: string): Promise<boolean> {
    // Delete git tag
    const tagName = this.getTagName(checkpointId);
    await this.runGitCommand(['tag', '-d', tagName]);

    // Delete from database
    await this.db.deleteCheckpoint(checkpointId);

    this.logger.info('Checkpoint deleted', { checkpointId });
    return true;
  }

  /**
   * Delete all checkpoints for the session
   */
  async deleteAllCheckpoints(): Promise<number> {
    // Get all checkpoints first to delete their tags
    const checkpoints = await this.listCheckpoints();

    for (const checkpoint of checkpoints) {
      const tagName = this.getTagName(checkpoint.id);
      await this.runGitCommand(['tag', '-d', tagName]);
    }

    // Delete from database
    const deleted = await this.db.deleteSessionCheckpoints(this.config.sessionId);

    this.logger.info('All checkpoints deleted', {
      sessionId: this.config.sessionId,
      count: deleted,
    });

    return deleted;
  }

  /**
   * Start automatic checkpoint creation at intervals
   */
  startAutoCheckpoint(
    intervalMinutes: number,
    metricsProvider: () => Promise<SessionMetrics | null>
  ): void {
    if (this.intervalId) {
      this.stopAutoCheckpoint();
    }

    const intervalMs = intervalMinutes * 60 * 1000;

    this.logger.info('Starting auto checkpoint', { intervalMinutes });

    this.intervalId = setInterval(async () => {
      try {
        const metrics = await metricsProvider();
        await this.createCheckpoint('Auto checkpoint', metrics);
      } catch (error) {
        this.logger.error('Auto checkpoint failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }, intervalMs);
  }

  /**
   * Stop automatic checkpoint creation
   */
  stopAutoCheckpoint(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      this.logger.info('Auto checkpoint stopped');
    }
  }

  /**
   * Create initial checkpoint before starting work
   */
  async createInitialCheckpoint(): Promise<Checkpoint> {
    return this.createCheckpoint('Initial checkpoint - before cleaning started');
  }

  /**
   * Create final checkpoint after work is done
   */
  async createFinalCheckpoint(metrics: SessionMetrics): Promise<Checkpoint> {
    return this.createCheckpoint('Final checkpoint - cleaning completed', metrics);
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private getTagName(checkpointId: string): string {
    return `sloppy-checkpoint-${checkpointId.substring(0, 8)}`;
  }

  private async getCurrentCommitHash(): Promise<string | null> {
    const result = await this.runGitCommand(['rev-parse', 'HEAD']);
    if (result.success) {
      return result.output.trim();
    }
    return null;
  }

  private async hasUncommittedChanges(): Promise<boolean> {
    const result = await this.runGitCommand(['status', '--porcelain']);
    return result.success && result.output.trim().length > 0;
  }

  private async createGitTag(tagName: string, message: string): Promise<GitCommandResult> {
    return this.runGitCommand(['tag', '-a', tagName, '-m', message]);
  }

  private async runGitCommand(args: string[]): Promise<GitCommandResult> {
    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';

      const proc = spawn('git', args, {
        cwd: this.config.repositoryPath,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
        },
      });

      proc.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('error', (error) => {
        resolve({
          success: false,
          output: stdout,
          error: error.message,
        });
      });

      proc.on('close', (exitCode) => {
        resolve({
          success: exitCode === 0,
          output: stdout,
          error: exitCode !== 0 ? stderr : undefined,
        });
      });
    });
  }

  private toDbCheckpoint(checkpoint: Checkpoint): DatabaseCheckpoint {
    return {
      ...checkpoint,
      createdAt: checkpoint.createdAt.toISOString(),
    };
  }

  private fromDbCheckpoint(dbCheckpoint: DatabaseCheckpoint): Checkpoint {
    return {
      ...dbCheckpoint,
      createdAt: new Date(dbCheckpoint.createdAt),
    };
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createCheckpointService(
  config: CheckpointServiceConfig,
  logger: Logger,
  db: CheckpointDatabaseAdapter,
  issueTracker: IssueTracker
): CheckpointService {
  return new CheckpointService(config, logger, db, issueTracker);
}

// ============================================================================
// In-Memory Database Adapter (for testing)
// ============================================================================

export class InMemoryCheckpointDatabaseAdapter implements CheckpointDatabaseAdapter {
  private checkpoints: Map<string, DatabaseCheckpoint> = new Map();

  async insertCheckpoint(checkpoint: DatabaseCheckpoint): Promise<void> {
    this.checkpoints.set(checkpoint.id, { ...checkpoint });
  }

  async getCheckpoint(id: string): Promise<DatabaseCheckpoint | null> {
    return this.checkpoints.get(id) ?? null;
  }

  async getCheckpoints(sessionId: string): Promise<DatabaseCheckpoint[]> {
    const results: DatabaseCheckpoint[] = [];
    for (const checkpoint of this.checkpoints.values()) {
      if (checkpoint.sessionId === sessionId) {
        results.push({ ...checkpoint });
      }
    }
    // Sort by creation date descending
    results.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    return results;
  }

  async getLatestCheckpoint(sessionId: string): Promise<DatabaseCheckpoint | null> {
    const checkpoints = await this.getCheckpoints(sessionId);
    return checkpoints.length > 0 ? checkpoints[0] : null;
  }

  async deleteCheckpoint(id: string): Promise<void> {
    this.checkpoints.delete(id);
  }

  async deleteSessionCheckpoints(sessionId: string): Promise<number> {
    let deleted = 0;
    for (const [id, checkpoint] of this.checkpoints.entries()) {
      if (checkpoint.sessionId === sessionId) {
        this.checkpoints.delete(id);
        deleted++;
      }
    }
    return deleted;
  }

  // Utility method for testing
  clear(): void {
    this.checkpoints.clear();
  }
}
