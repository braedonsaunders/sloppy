/**
 * Metrics Collector Service for Sloppy
 * Collects, aggregates, and persists session metrics
 */

import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import {
  SessionMetrics,
  MetricsDelta,
  Logger,
  DatabaseMetrics,
} from './types.js';
import { IssueTracker } from './issue-tracker.js';
import { SloppyEventEmitter } from './event-emitter.js';

// ============================================================================
// Types
// ============================================================================

export interface MetricsDatabaseAdapter {
  insertMetrics(metrics: DatabaseMetrics): Promise<void>;
  getMetrics(sessionId: string): Promise<DatabaseMetrics[]>;
  getLatestMetrics(sessionId: string): Promise<DatabaseMetrics | null>;
  deleteSessionMetrics(sessionId: string): Promise<number>;
}

export interface MetricsCollectorConfig {
  sessionId: string;
  repositoryPath: string;
  collectionIntervalMs: number;
}

interface GitDiffStats {
  linesAdded: number;
  linesRemoved: number;
  filesModified: number;
}

// ============================================================================
// Metrics Collector Class
// ============================================================================

export class MetricsCollector {
  private config: MetricsCollectorConfig;
  private logger: Logger;
  private db: MetricsDatabaseAdapter;
  private issueTracker: IssueTracker;
  private eventEmitter: SloppyEventEmitter;

  private intervalId: NodeJS.Timeout | null = null;
  private startTime: Date;
  private previousMetrics: SessionMetrics | null = null;

  // Counters
  private verificationTotal = 0;
  private verificationPassed = 0;
  private verificationFailed = 0;
  private totalRetries = 0;
  private successfulRetries = 0;
  private aiRequestCount = 0;
  private aiTokensUsed = 0;
  private aiCost = 0;

  constructor(
    config: MetricsCollectorConfig,
    logger: Logger,
    db: MetricsDatabaseAdapter,
    issueTracker: IssueTracker,
    eventEmitter: SloppyEventEmitter
  ) {
    this.config = config;
    this.logger = logger;
    this.db = db;
    this.issueTracker = issueTracker;
    this.eventEmitter = eventEmitter;
    this.startTime = new Date();
  }

  /**
   * Start periodic metrics collection
   */
  startCollection(): void {
    if (this.intervalId) {
      this.stopCollection();
    }

    this.startTime = new Date();
    this.logger.info('Starting metrics collection', {
      intervalMs: this.config.collectionIntervalMs,
    });

    // Collect initial metrics
    this.collectAndStore().catch((error) => {
      this.logger.error('Initial metrics collection failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });

    // Set up periodic collection
    this.intervalId = setInterval(async () => {
      try {
        await this.collectAndStore();
      } catch (error) {
        this.logger.error('Periodic metrics collection failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }, this.config.collectionIntervalMs);
  }

  /**
   * Stop periodic metrics collection
   */
  stopCollection(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      this.logger.info('Metrics collection stopped');
    }
  }

  /**
   * Collect current metrics
   */
  async collectMetrics(): Promise<SessionMetrics> {
    const issueStats = await this.issueTracker.getStats();
    const gitStats = await this.getGitDiffStats();
    const elapsedMs = Date.now() - this.startTime.getTime();

    // Calculate average fix time
    const fixedCount = issueStats.resolved;
    const averageFixTime = fixedCount > 0 ? elapsedMs / fixedCount : 0;

    const metrics: SessionMetrics = {
      sessionId: this.config.sessionId,
      timestamp: new Date(),

      // Issue metrics
      totalIssues: issueStats.total,
      resolvedIssues: issueStats.resolved,
      failedIssues: issueStats.failed,
      skippedIssues: issueStats.skipped,
      inProgressIssues: issueStats.inProgress,

      // Timing metrics
      elapsedTimeMs: elapsedMs,
      averageFixTimeMs: averageFixTime,

      // Verification metrics
      totalVerifications: this.verificationTotal,
      passedVerifications: this.verificationPassed,
      failedVerifications: this.verificationFailed,

      // Retry metrics
      totalRetries: this.totalRetries,
      successfulRetries: this.successfulRetries,

      // Code metrics
      linesAdded: gitStats.linesAdded,
      linesRemoved: gitStats.linesRemoved,
      filesModified: gitStats.filesModified,

      // AI metrics
      aiRequestCount: this.aiRequestCount,
      aiTokensUsed: this.aiTokensUsed,
      aiCost: this.aiCost,
    };

    return metrics;
  }

  /**
   * Collect and store metrics, emitting update event
   */
  async collectAndStore(): Promise<SessionMetrics> {
    const metrics = await this.collectMetrics();

    // Calculate delta
    const delta = this.calculateDelta(metrics);

    // Store in database
    await this.db.insertMetrics(this.toDbMetrics(metrics));

    // Emit event
    await this.eventEmitter.emit({
      type: 'metrics:updated',
      sessionId: this.config.sessionId,
      timestamp: new Date(),
      metrics,
      delta,
    });

    // Update previous metrics
    this.previousMetrics = metrics;

    this.logger.debug('Metrics collected', {
      resolved: metrics.resolvedIssues,
      failed: metrics.failedIssues,
      elapsedMs: metrics.elapsedTimeMs,
    });

    return metrics;
  }

  /**
   * Record a verification result
   */
  recordVerification(passed: boolean): void {
    this.verificationTotal++;
    if (passed) {
      this.verificationPassed++;
    } else {
      this.verificationFailed++;
    }
  }

  /**
   * Record a retry attempt
   */
  recordRetry(successful: boolean): void {
    this.totalRetries++;
    if (successful) {
      this.successfulRetries++;
    }
  }

  /**
   * Record AI usage
   */
  recordAIUsage(tokensUsed: number, cost: number): void {
    this.aiRequestCount++;
    this.aiTokensUsed += tokensUsed;
    this.aiCost += cost;
  }

  /**
   * Get metrics history for the session
   */
  async getMetricsHistory(): Promise<SessionMetrics[]> {
    const dbMetrics = await this.db.getMetrics(this.config.sessionId);
    return dbMetrics.map((m) => this.fromDbMetrics(m));
  }

  /**
   * Get the latest stored metrics
   */
  async getLatestMetrics(): Promise<SessionMetrics | null> {
    const dbMetrics = await this.db.getLatestMetrics(this.config.sessionId);
    return dbMetrics ? this.fromDbMetrics(dbMetrics) : null;
  }

  /**
   * Get current metrics (without storing)
   */
  async getCurrentMetrics(): Promise<SessionMetrics> {
    return this.collectMetrics();
  }

  /**
   * Reset all counters (for session restart)
   */
  reset(): void {
    this.startTime = new Date();
    this.previousMetrics = null;
    this.verificationTotal = 0;
    this.verificationPassed = 0;
    this.verificationFailed = 0;
    this.totalRetries = 0;
    this.successfulRetries = 0;
    this.aiRequestCount = 0;
    this.aiTokensUsed = 0;
    this.aiCost = 0;

    this.logger.info('Metrics collector reset');
  }

  /**
   * Delete all metrics for the session
   */
  async deleteAllMetrics(): Promise<number> {
    const deleted = await this.db.deleteSessionMetrics(this.config.sessionId);
    this.logger.info('Session metrics deleted', { count: deleted });
    return deleted;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private calculateDelta(current: SessionMetrics): MetricsDelta {
    const changes: Partial<SessionMetrics> = {};

    if (this.previousMetrics) {
      const prev = this.previousMetrics;

      // Calculate changes for numeric fields
      if (current.resolvedIssues !== prev.resolvedIssues) {
        changes.resolvedIssues = current.resolvedIssues - prev.resolvedIssues;
      }
      if (current.failedIssues !== prev.failedIssues) {
        changes.failedIssues = current.failedIssues - prev.failedIssues;
      }
      if (current.totalVerifications !== prev.totalVerifications) {
        changes.totalVerifications =
          current.totalVerifications - prev.totalVerifications;
      }
      if (current.linesAdded !== prev.linesAdded) {
        changes.linesAdded = current.linesAdded - prev.linesAdded;
      }
      if (current.linesRemoved !== prev.linesRemoved) {
        changes.linesRemoved = current.linesRemoved - prev.linesRemoved;
      }
      if (current.filesModified !== prev.filesModified) {
        changes.filesModified = current.filesModified - prev.filesModified;
      }
      if (current.aiRequestCount !== prev.aiRequestCount) {
        changes.aiRequestCount = current.aiRequestCount - prev.aiRequestCount;
      }
      if (current.aiTokensUsed !== prev.aiTokensUsed) {
        changes.aiTokensUsed = current.aiTokensUsed - prev.aiTokensUsed;
      }
    }

    return {
      current,
      previous: this.previousMetrics,
      changes,
    };
  }

  private async getGitDiffStats(): Promise<GitDiffStats> {
    const stats: GitDiffStats = {
      linesAdded: 0,
      linesRemoved: 0,
      filesModified: 0,
    };

    try {
      const result = await this.runGitCommand([
        'diff',
        '--stat',
        '--numstat',
        'HEAD~1',
      ]);

      if (!result.success) {
        // If HEAD~1 doesn't exist (first commit), try against empty tree
        const altResult = await this.runGitCommand([
          'diff',
          '--stat',
          '--numstat',
          '--cached',
        ]);

        if (altResult.success) {
          this.parseGitStats(altResult.output, stats);
        }
      } else {
        this.parseGitStats(result.output, stats);
      }
    } catch (error) {
      this.logger.debug('Failed to get git diff stats', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return stats;
  }

  private parseGitStats(output: string, stats: GitDiffStats): void {
    const lines = output.split('\n');

    for (const line of lines) {
      // numstat format: added<tab>removed<tab>filename
      const match = line.match(/^(\d+)\t(\d+)\t(.+)$/);
      if (match) {
        stats.linesAdded += parseInt(match[1], 10);
        stats.linesRemoved += parseInt(match[2], 10);
        stats.filesModified++;
      }
    }
  }

  private async runGitCommand(
    args: string[]
  ): Promise<{ success: boolean; output: string }> {
    return new Promise((resolve) => {
      let output = '';

      const proc = spawn('git', args, {
        cwd: this.config.repositoryPath,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
        },
      });

      proc.stdout?.on('data', (data) => {
        output += data.toString();
      });

      proc.stderr?.on('data', (data) => {
        output += data.toString();
      });

      proc.on('error', () => {
        resolve({ success: false, output: '' });
      });

      proc.on('close', (exitCode) => {
        resolve({ success: exitCode === 0, output });
      });
    });
  }

  private toDbMetrics(metrics: SessionMetrics): DatabaseMetrics {
    return {
      id: randomUUID(),
      ...metrics,
      timestamp: metrics.timestamp.toISOString(),
    };
  }

  private fromDbMetrics(dbMetrics: DatabaseMetrics): SessionMetrics {
    const { id, ...rest } = dbMetrics;
    return {
      ...rest,
      timestamp: new Date(dbMetrics.timestamp),
    };
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createMetricsCollector(
  config: MetricsCollectorConfig,
  logger: Logger,
  db: MetricsDatabaseAdapter,
  issueTracker: IssueTracker,
  eventEmitter: SloppyEventEmitter
): MetricsCollector {
  return new MetricsCollector(config, logger, db, issueTracker, eventEmitter);
}

// ============================================================================
// In-Memory Database Adapter (for testing)
// ============================================================================

export class InMemoryMetricsDatabaseAdapter implements MetricsDatabaseAdapter {
  private metrics: Map<string, DatabaseMetrics> = new Map();

  async insertMetrics(metrics: DatabaseMetrics): Promise<void> {
    this.metrics.set(metrics.id, { ...metrics });
  }

  async getMetrics(sessionId: string): Promise<DatabaseMetrics[]> {
    const results: DatabaseMetrics[] = [];
    for (const metrics of this.metrics.values()) {
      if (metrics.sessionId === sessionId) {
        results.push({ ...metrics });
      }
    }
    // Sort by timestamp ascending
    results.sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    return results;
  }

  async getLatestMetrics(sessionId: string): Promise<DatabaseMetrics | null> {
    const all = await this.getMetrics(sessionId);
    return all.length > 0 ? all[all.length - 1] : null;
  }

  async deleteSessionMetrics(sessionId: string): Promise<number> {
    let deleted = 0;
    for (const [id, metrics] of this.metrics.entries()) {
      if (metrics.sessionId === sessionId) {
        this.metrics.delete(id);
        deleted++;
      }
    }
    return deleted;
  }

  // Utility method for testing
  clear(): void {
    this.metrics.clear();
  }
}

// ============================================================================
// Metrics Formatting Utilities
// ============================================================================

/**
 * Format metrics as a human-readable summary
 */
export function formatMetricsSummary(metrics: SessionMetrics): string {
  const lines: string[] = [];

  const elapsedMinutes = Math.floor(metrics.elapsedTimeMs / 60000);
  const elapsedSeconds = Math.floor((metrics.elapsedTimeMs % 60000) / 1000);

  lines.push('=== Session Metrics ===');
  lines.push(`Duration: ${elapsedMinutes}m ${elapsedSeconds}s`);
  lines.push('');
  lines.push('Issues:');
  lines.push(`  Total: ${metrics.totalIssues}`);
  lines.push(`  Resolved: ${metrics.resolvedIssues}`);
  lines.push(`  Failed: ${metrics.failedIssues}`);
  lines.push(`  Skipped: ${metrics.skippedIssues}`);
  lines.push(`  In Progress: ${metrics.inProgressIssues}`);
  lines.push('');
  lines.push('Verification:');
  lines.push(`  Total: ${metrics.totalVerifications}`);
  lines.push(`  Passed: ${metrics.passedVerifications}`);
  lines.push(`  Failed: ${metrics.failedVerifications}`);
  lines.push('');
  lines.push('Code Changes:');
  lines.push(`  Files Modified: ${metrics.filesModified}`);
  lines.push(`  Lines Added: ${metrics.linesAdded}`);
  lines.push(`  Lines Removed: ${metrics.linesRemoved}`);
  lines.push('');
  lines.push('AI Usage:');
  lines.push(`  Requests: ${metrics.aiRequestCount}`);
  lines.push(`  Tokens: ${metrics.aiTokensUsed}`);
  lines.push(`  Cost: $${metrics.aiCost.toFixed(4)}`);

  return lines.join('\n');
}

/**
 * Calculate success rate percentage
 */
export function calculateSuccessRate(metrics: SessionMetrics): number {
  const attempted = metrics.resolvedIssues + metrics.failedIssues;
  if (attempted === 0) return 0;
  return (metrics.resolvedIssues / attempted) * 100;
}

/**
 * Calculate completion percentage
 */
export function calculateCompletionRate(metrics: SessionMetrics): number {
  if (metrics.totalIssues === 0) return 100;
  const completed =
    metrics.resolvedIssues + metrics.failedIssues + metrics.skippedIssues;
  return (completed / metrics.totalIssues) * 100;
}
