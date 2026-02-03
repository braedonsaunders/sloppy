/**
 * Sloppy Orchestrator
 * Main orchestration loop that coordinates the code cleaning process
 */

import { spawn } from 'child_process';
import { readFile, writeFile } from 'fs/promises';
import { randomUUID } from 'crypto';
import path from 'path';

import {
  Session,
  SessionConfig,
  SessionStatus,
  Issue,
  IssueStatus,
  VerificationResult,
  VerifyResult,
  SessionSummary,
  CommitSummary,
  SloppyEvent,
  FixRequest,
  FixResponse,
  FixAttempt,
  Logger,
  OrchestratorConfig,
  DEFAULT_ORCHESTRATOR_CONFIG,
} from './types';
import { SloppyEventEmitter } from './event-emitter';
import { VerificationService, extractVerificationErrors } from './verification';
import { IssueTracker, DatabaseAdapter as IssueDbAdapter } from './issue-tracker';
import { CheckpointService, CheckpointDatabaseAdapter } from './checkpoint';
import { MetricsCollector, MetricsDatabaseAdapter } from './metrics-collector';

// ============================================================================
// Types
// ============================================================================

export interface OrchestratorDependencies {
  logger: Logger;
  eventEmitter: SloppyEventEmitter;
  verificationService: VerificationService;
  issueTracker: IssueTracker;
  checkpointService: CheckpointService;
  metricsCollector: MetricsCollector;
  aiProvider: AIProvider;
  analyzer: CodeAnalyzer;
}

export interface AIProvider {
  generateFix(request: FixRequest): Promise<FixResponse>;
}

export interface CodeAnalyzer {
  analyze(
    repositoryPath: string,
    types: string[],
    excludePatterns: string[]
  ): Promise<Issue[]>;
}

export interface SessionDatabaseAdapter {
  getSession(id: string): Promise<Session | null>;
  updateSession(id: string, update: Partial<Session>): Promise<void>;
}

interface GitCommandResult {
  success: boolean;
  output: string;
  error?: string;
}

// ============================================================================
// Orchestrator Class
// ============================================================================

export class Orchestrator {
  private session: Session;
  private config: OrchestratorConfig;
  private deps: OrchestratorDependencies;
  private sessionDb: SessionDatabaseAdapter;
  private logger: Logger;

  private isRunning = false;
  private isPaused = false;
  private isStopped = false;
  private startTime: Date | null = null;
  private commits: CommitSummary[] = [];
  private fixAttempts: Map<string, FixAttempt[]> = new Map();

  constructor(
    session: Session,
    deps: OrchestratorDependencies,
    sessionDb: SessionDatabaseAdapter,
    config: Partial<OrchestratorConfig> = {}
  ) {
    this.session = session;
    this.deps = deps;
    this.sessionDb = sessionDb;
    this.logger = deps.logger;
    this.config = { ...DEFAULT_ORCHESTRATOR_CONFIG, ...config };
  }

  /**
   * Main orchestration loop
   * Runs until all issues are resolved, timeout, or stop signal
   */
  async run(): Promise<void> {
    if (this.isRunning) {
      throw new Error('Orchestrator is already running');
    }

    this.isRunning = true;
    this.isStopped = false;
    this.startTime = new Date();

    this.logger.info('Starting orchestration', {
      sessionId: this.session.id,
      repositoryPath: this.session.repositoryPath,
    });

    try {
      // Phase 0: Setup
      await this.setup();

      // Emit session started
      await this.emit({
        type: 'session:started',
        sessionId: this.session.id,
        timestamp: new Date(),
        config: this.session.config,
      });

      // Phase 1: Create cleaning branch
      await this.createCleaningBranch();

      // Phase 2: Create initial checkpoint
      await this.deps.checkpointService.createInitialCheckpoint();
      await this.emit({
        type: 'checkpoint:created',
        sessionId: this.session.id,
        timestamp: new Date(),
        checkpoint: await this.deps.checkpointService.getLatestCheckpoint() as any,
      });

      // Phase 3: Run full analysis
      const issues = await this.analyzeRepository();

      if (issues.length === 0) {
        this.logger.info('No issues found, session complete');
        await this.completeSession('No issues found');
        return;
      }

      // Phase 4: Prioritize issues
      const prioritizedIssues = this.prioritizeIssues(issues);

      // Phase 5: Fix loop
      await this.runFixLoop(prioritizedIssues);

      // Phase 6: Final verification
      if (!this.isStopped) {
        await this.runFinalVerification();
      }

      // Phase 7: Generate summary and complete
      await this.completeSession();
    } catch (error) {
      await this.handleFatalError(error);
    } finally {
      this.isRunning = false;
      this.deps.metricsCollector.stopCollection();
      this.deps.checkpointService.stopAutoCheckpoint();
    }
  }

  /**
   * Pause the orchestration
   */
  async pause(): Promise<void> {
    if (!this.isRunning || this.isPaused) return;

    this.logger.info('Pausing orchestration', { sessionId: this.session.id });
    this.isPaused = true;

    await this.updateSessionStatus('paused');
    await this.emit({
      type: 'session:paused',
      sessionId: this.session.id,
      timestamp: new Date(),
    });
  }

  /**
   * Resume the orchestration
   */
  async resume(): Promise<void> {
    if (!this.isRunning || !this.isPaused) return;

    this.logger.info('Resuming orchestration', { sessionId: this.session.id });
    this.isPaused = false;

    await this.updateSessionStatus('running');
    await this.emit({
      type: 'session:resumed',
      sessionId: this.session.id,
      timestamp: new Date(),
    });
  }

  /**
   * Stop the orchestration
   */
  async stop(reason?: string): Promise<void> {
    if (!this.isRunning) return;

    this.logger.info('Stopping orchestration', {
      sessionId: this.session.id,
      reason,
    });
    this.isStopped = true;
    this.isPaused = false;

    await this.updateSessionStatus('stopped');
    await this.emit({
      type: 'session:stopped',
      sessionId: this.session.id,
      timestamp: new Date(),
      reason,
    });
  }

  /**
   * Get current status
   */
  getStatus(): {
    isRunning: boolean;
    isPaused: boolean;
    isStopped: boolean;
    elapsedMs: number;
  } {
    return {
      isRunning: this.isRunning,
      isPaused: this.isPaused,
      isStopped: this.isStopped,
      elapsedMs: this.startTime ? Date.now() - this.startTime.getTime() : 0,
    };
  }

  // ============================================================================
  // Phase Methods
  // ============================================================================

  /**
   * Setup phase - initialize services
   */
  private async setup(): Promise<void> {
    this.logger.debug('Setting up orchestration');

    // Start metrics collection
    this.deps.metricsCollector.startCollection();

    // Start auto checkpointing
    const checkpointInterval = this.session.config.checkpointIntervalMinutes;
    if (checkpointInterval > 0) {
      this.deps.checkpointService.startAutoCheckpoint(
        checkpointInterval,
        () => this.deps.metricsCollector.getCurrentMetrics()
      );
    }

    // Update session status
    await this.updateSessionStatus('running');
  }

  /**
   * Create the cleaning branch
   */
  private async createCleaningBranch(): Promise<void> {
    this.logger.info('Creating cleaning branch', {
      branch: this.session.cleaningBranch,
    });

    // Checkout base branch first
    const checkoutResult = await this.runGitCommand([
      'checkout',
      this.session.branch,
    ]);
    if (!checkoutResult.success) {
      throw new Error(
        `Failed to checkout base branch: ${checkoutResult.error}`
      );
    }

    // Create and checkout cleaning branch
    const createResult = await this.runGitCommand([
      'checkout',
      '-b',
      this.session.cleaningBranch,
    ]);

    if (!createResult.success) {
      // Branch might already exist
      if (createResult.error?.includes('already exists')) {
        const switchResult = await this.runGitCommand([
          'checkout',
          this.session.cleaningBranch,
        ]);
        if (!switchResult.success) {
          throw new Error(
            `Failed to switch to cleaning branch: ${switchResult.error}`
          );
        }
      } else {
        throw new Error(
          `Failed to create cleaning branch: ${createResult.error}`
        );
      }
    }

    this.logger.info('Cleaning branch ready', {
      branch: this.session.cleaningBranch,
    });
  }

  /**
   * Phase 1: Initial analysis
   */
  private async analyzeRepository(): Promise<Issue[]> {
    this.logger.info('Starting repository analysis');

    await this.emit({
      type: 'analysis:started',
      sessionId: this.session.id,
      timestamp: new Date(),
      analysisTypes: this.session.config.analysisTypes,
    });

    try {
      const issues = await this.deps.analyzer.analyze(
        this.session.repositoryPath,
        this.session.config.analysisTypes,
        this.session.config.excludePatterns
      );

      // Add session ID to each issue
      const sessionIssues = issues.map((issue) => ({
        ...issue,
        sessionId: this.session.id,
        status: 'pending' as IssueStatus,
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      // Store issues
      await this.deps.issueTracker.addIssues(sessionIssues);

      // Emit completion
      const stats = await this.deps.issueTracker.getStats();
      await this.emit({
        type: 'analysis:completed',
        sessionId: this.session.id,
        timestamp: new Date(),
        totalIssues: stats.total,
        byCategory: stats.byCategory,
        bySeverity: stats.bySeverity,
      });

      this.logger.info('Analysis completed', {
        totalIssues: sessionIssues.length,
      });

      return sessionIssues;
    } catch (error) {
      this.logger.error('Analysis failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Phase 2: Prioritize issues
   */
  private prioritizeIssues(issues: Issue[]): Issue[] {
    this.logger.info('Prioritizing issues', { count: issues.length });

    this.deps.issueTracker.prioritize();

    // Return issues in prioritized order
    // The tracker maintains the order internally
    return issues;
  }

  /**
   * Phase 3: Main fix loop
   */
  private async runFixLoop(issues: Issue[]): Promise<void> {
    this.logger.info('Starting fix loop', { totalIssues: issues.length });

    let processedCount = 0;

    while (!this.isStopped) {
      // Check timeout
      if (this.isTimeoutReached()) {
        this.logger.warn('Session timeout reached');
        await this.handleTimeout();
        break;
      }

      // Check control signals
      await this.checkControlSignals();

      if (this.isStopped) break;

      // Get next issue
      const issue = await this.deps.issueTracker.getNextIssue();

      if (!issue) {
        this.logger.info('No more issues to process');
        break;
      }

      processedCount++;
      this.logger.info('Processing issue', {
        issueId: issue.id,
        type: issue.type,
        file: issue.filePath,
        progress: `${processedCount}/${issues.length}`,
      });

      // Process the issue
      await this.processIssue(issue);

      // Update session progress
      const stats = await this.deps.issueTracker.getStats();
      await this.sessionDb.updateSession(this.session.id, {
        totalIssues: stats.total,
        resolvedIssues: stats.resolved,
        failedIssues: stats.failed,
        currentIssueId: null,
        updatedAt: new Date(),
      });
    }

    this.logger.info('Fix loop completed', {
      processed: processedCount,
      stopped: this.isStopped,
    });
  }

  /**
   * Process a single issue
   */
  private async processIssue(issue: Issue): Promise<void> {
    const maxRetries = this.session.config.maxRetries;
    let attempt = 0;
    let success = false;

    // Verify issue still exists
    const stillExists = await this.verifyIssueStillExists(issue);
    if (!stillExists) {
      this.logger.info('Issue no longer exists, skipping', {
        issueId: issue.id,
      });
      await this.deps.issueTracker.markSkipped(issue.id, 'Issue no longer exists in code');
      await this.emit({
        type: 'issue:skipped',
        sessionId: this.session.id,
        timestamp: new Date(),
        issue,
        reason: 'Issue no longer exists in code',
      });
      return;
    }

    // Mark as in progress
    await this.deps.issueTracker.markInProgress(issue.id);
    await this.sessionDb.updateSession(this.session.id, {
      currentIssueId: issue.id,
    });

    // Emit start event
    await this.emit({
      type: 'issue:started',
      sessionId: this.session.id,
      timestamp: new Date(),
      issue,
      attempt: 1,
    });

    while (attempt < maxRetries && !success && !this.isStopped) {
      attempt++;

      try {
        success = await this.fixIssue(issue);

        if (success) {
          await this.deps.issueTracker.markResolved(issue.id);

          // Commit if configured
          if (this.session.config.commitAfterEachFix) {
            const commitHash = await this.commitFix(issue);
            if (commitHash) {
              this.commits.push({
                hash: commitHash,
                message: this.generateCommitMessage(issue),
                issueId: issue.id,
                filesChanged: [issue.filePath],
                timestamp: new Date(),
              });
            }
          }

          // Emit resolved event
          await this.emit({
            type: 'issue:resolved',
            sessionId: this.session.id,
            timestamp: new Date(),
            issue,
            commitHash: this.commits[this.commits.length - 1]?.hash ?? '',
            duration: 0, // TODO: Track actual duration
          });
        } else if (attempt < maxRetries) {
          // Record retry
          await this.deps.issueTracker.incrementRetry(issue.id);
          this.deps.metricsCollector.recordRetry(false);

          this.logger.info('Retrying issue', {
            issueId: issue.id,
            attempt: attempt + 1,
            maxRetries,
          });
        }
      } catch (error) {
        this.logger.error('Error fixing issue', {
          issueId: issue.id,
          attempt,
          error: error instanceof Error ? error.message : String(error),
        });

        if (attempt >= maxRetries) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          await this.deps.issueTracker.markFailed(issue.id, errorMessage);

          await this.emit({
            type: 'issue:failed',
            sessionId: this.session.id,
            timestamp: new Date(),
            issue,
            error: errorMessage,
            retryCount: attempt,
          });
        }
      }
    }

    if (!success && !this.isStopped) {
      const lastAttempts = this.fixAttempts.get(issue.id) ?? [];
      const lastError = lastAttempts[lastAttempts.length - 1]?.feedback ?? 'Max retries exceeded';

      await this.deps.issueTracker.markFailed(issue.id, lastError);

      await this.emit({
        type: 'issue:failed',
        sessionId: this.session.id,
        timestamp: new Date(),
        issue,
        error: lastError,
        retryCount: attempt,
      });
    }
  }

  /**
   * Phase 4: Fix an issue
   */
  private async fixIssue(issue: Issue): Promise<boolean> {
    // Emit progress
    await this.emit({
      type: 'issue:progress',
      sessionId: this.session.id,
      timestamp: new Date(),
      issueId: issue.id,
      step: 'analyzing',
    });

    // Read file content
    const filePath = path.join(this.session.repositoryPath, issue.filePath);
    const fileContent = await readFile(filePath, 'utf-8');

    // Get previous attempts for context
    const previousAttempts = this.fixAttempts.get(issue.id) ?? [];

    // Build fix request
    const request: FixRequest = {
      issue,
      fileContent,
      context: {
        previousAttempts,
      },
    };

    // Emit progress
    await this.emit({
      type: 'issue:progress',
      sessionId: this.session.id,
      timestamp: new Date(),
      issueId: issue.id,
      step: 'generating_fix',
    });

    // Get fix from AI
    const response = await this.deps.aiProvider.generateFix(request);

    // Record AI usage
    if (response.tokensUsed) {
      this.deps.metricsCollector.recordAIUsage(response.tokensUsed, 0);
    }

    if (!response.success || !response.diff) {
      this.logger.warn('AI failed to generate fix', {
        issueId: issue.id,
        error: response.error,
      });
      return false;
    }

    // Emit progress
    await this.emit({
      type: 'issue:progress',
      sessionId: this.session.id,
      timestamp: new Date(),
      issueId: issue.id,
      step: 'applying_fix',
    });

    // Apply the diff
    const applySuccess = await this.applyDiff(issue, response.diff);
    if (!applySuccess) {
      this.logger.warn('Failed to apply diff', { issueId: issue.id });
      return false;
    }

    // Phase 5: Verification
    const verifyResult = await this.verifyFix(issue, response.diff);

    // Store attempt
    const attempt: FixAttempt = {
      attempt: previousAttempts.length + 1,
      diff: response.diff,
      verificationResult: verifyResult.verification,
      feedback: verifyResult.feedback,
    };
    previousAttempts.push(attempt);
    this.fixAttempts.set(issue.id, previousAttempts);

    if (!verifyResult.success) {
      // Revert the change
      await this.revertChanges(issue.filePath);

      // Record failed retry if not first attempt
      if (previousAttempts.length > 1) {
        this.deps.metricsCollector.recordRetry(false);
      }

      return false;
    }

    // Record successful verification
    this.deps.metricsCollector.recordVerification(true);

    // Record successful retry if not first attempt
    if (previousAttempts.length > 1) {
      this.deps.metricsCollector.recordRetry(true);
    }

    return true;
  }

  /**
   * Phase 5: Verification
   */
  private async verifyFix(issue: Issue, diff: string): Promise<VerifyResult> {
    if (!this.session.config.runVerificationAfterEachFix) {
      return {
        success: true,
        verification: {
          overall: 'skipped',
          tests: null,
          lint: null,
          build: null,
          duration: 0,
          timestamp: new Date(),
        },
      };
    }

    // Emit progress
    await this.emit({
      type: 'issue:progress',
      sessionId: this.session.id,
      timestamp: new Date(),
      issueId: issue.id,
      step: 'verifying',
    });

    // Emit verification started
    const verificationTypes: ('test' | 'lint' | 'build')[] = [];
    if (this.session.config.testCommand) verificationTypes.push('test');
    if (this.session.config.lintCommand) verificationTypes.push('lint');
    if (this.session.config.buildCommand) verificationTypes.push('build');

    await this.emit({
      type: 'verification:started',
      sessionId: this.session.id,
      timestamp: new Date(),
      issueId: issue.id,
      types: verificationTypes,
    });

    // Run verification suite
    const result = await this.runVerificationSuite();

    // Emit verification completed
    await this.emit({
      type: 'verification:completed',
      sessionId: this.session.id,
      timestamp: new Date(),
      issueId: issue.id,
      result,
    });

    this.deps.metricsCollector.recordVerification(result.overall === 'pass');

    const success = result.overall === 'pass' || result.overall === 'skipped';

    return {
      success,
      verification: result,
      feedback: success ? undefined : extractVerificationErrors(result),
    };
  }

  /**
   * Verify issue still exists before fixing
   */
  private async verifyIssueStillExists(issue: Issue): Promise<boolean> {
    try {
      const filePath = path.join(this.session.repositoryPath, issue.filePath);
      const content = await readFile(filePath, 'utf-8');
      return this.deps.issueTracker.checkIssueExists(issue, content);
    } catch (error) {
      // File doesn't exist
      this.logger.debug('File not found for issue', {
        issueId: issue.id,
        filePath: issue.filePath,
      });
      return false;
    }
  }

  /**
   * Run verification suite
   */
  private async runVerificationSuite(): Promise<VerificationResult> {
    return this.deps.verificationService.runAll(this.session.config, {
      cwd: this.session.repositoryPath,
      timeout: this.config.verificationTimeoutMs,
    });
  }

  /**
   * Run final verification after all fixes
   */
  private async runFinalVerification(): Promise<void> {
    this.logger.info('Running final verification');

    await this.emit({
      type: 'verification:started',
      sessionId: this.session.id,
      timestamp: new Date(),
      types: ['test', 'lint', 'build'],
    });

    const result = await this.runVerificationSuite();

    await this.emit({
      type: 'verification:completed',
      sessionId: this.session.id,
      timestamp: new Date(),
      result,
    });

    this.logger.info('Final verification completed', {
      status: result.overall,
    });
  }

  /**
   * Check for control signals (pause/stop)
   */
  private async checkControlSignals(): Promise<void> {
    // Fetch latest session state from database
    const session = await this.sessionDb.getSession(this.session.id);

    if (!session) {
      this.logger.error('Session not found during control check');
      this.isStopped = true;
      return;
    }

    // Handle control signals
    switch (session.controlSignal) {
      case 'pause':
        if (!this.isPaused) {
          await this.pause();
        }
        break;
      case 'resume':
        if (this.isPaused) {
          await this.resume();
        }
        break;
      case 'stop':
        if (!this.isStopped) {
          await this.stop('User requested stop');
        }
        break;
    }

    // Clear the control signal
    if (session.controlSignal) {
      await this.sessionDb.updateSession(this.session.id, {
        controlSignal: null,
      });
    }

    // Wait while paused
    while (this.isPaused && !this.isStopped) {
      await this.sleep(1000);

      // Check for resume/stop while paused
      const pausedSession = await this.sessionDb.getSession(this.session.id);
      if (pausedSession?.controlSignal === 'resume') {
        await this.resume();
        await this.sessionDb.updateSession(this.session.id, {
          controlSignal: null,
        });
      } else if (pausedSession?.controlSignal === 'stop') {
        await this.stop('User requested stop');
        await this.sessionDb.updateSession(this.session.id, {
          controlSignal: null,
        });
      }
    }
  }

  /**
   * Check if session timeout is reached
   */
  private isTimeoutReached(): boolean {
    if (!this.startTime) return false;

    const elapsedMs = Date.now() - this.startTime.getTime();
    const timeoutMs = this.session.config.timeoutMinutes * 60 * 1000;

    return elapsedMs >= timeoutMs;
  }

  /**
   * Handle session timeout
   */
  private async handleTimeout(): Promise<void> {
    const elapsedMinutes = this.startTime
      ? Math.floor((Date.now() - this.startTime.getTime()) / 60000)
      : 0;

    await this.updateSessionStatus('timeout');

    await this.emit({
      type: 'session:timeout',
      sessionId: this.session.id,
      timestamp: new Date(),
      elapsedMinutes,
    });

    this.isStopped = true;
  }

  /**
   * Emit an event
   */
  private async emit(event: SloppyEvent): Promise<void> {
    await this.deps.eventEmitter.emit(event);
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private async updateSessionStatus(status: SessionStatus): Promise<void> {
    this.session.status = status;
    const update: Partial<Session> = {
      status,
      updatedAt: new Date(),
    };

    if (status === 'running' && !this.session.startedAt) {
      update.startedAt = new Date();
    }
    if (status === 'paused') {
      update.pausedAt = new Date();
    }
    if (['completed', 'failed', 'stopped', 'timeout'].includes(status)) {
      update.completedAt = new Date();
    }

    await this.sessionDb.updateSession(this.session.id, update);
  }

  private async applyDiff(issue: Issue, diff: string): Promise<boolean> {
    // For now, we'll apply the diff as a patch
    // In a real implementation, this would parse and apply unified diff
    try {
      const filePath = path.join(this.session.repositoryPath, issue.filePath);

      // Check if diff is actually full file content or a patch
      if (diff.startsWith('---') || diff.startsWith('diff --git')) {
        // Apply as patch
        const result = await this.runGitCommand(['apply', '--check', '-'], diff);
        if (!result.success) {
          this.logger.warn('Patch does not apply cleanly', {
            error: result.error,
          });
          return false;
        }
        await this.runGitCommand(['apply', '-'], diff);
      } else {
        // Assume it's the new file content
        await writeFile(filePath, diff, 'utf-8');
      }

      return true;
    } catch (error) {
      this.logger.error('Failed to apply diff', {
        issueId: issue.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  private async revertChanges(filePath: string): Promise<void> {
    await this.runGitCommand(['checkout', '--', filePath]);
  }

  private async commitFix(issue: Issue): Promise<string | null> {
    const message = this.generateCommitMessage(issue);

    // Stage the file
    await this.runGitCommand(['add', issue.filePath]);

    // Commit
    const result = await this.runGitCommand(['commit', '-m', message]);

    if (!result.success) {
      this.logger.warn('Failed to commit fix', { error: result.error });
      return null;
    }

    // Get commit hash
    const hashResult = await this.runGitCommand(['rev-parse', 'HEAD']);
    return hashResult.success ? hashResult.output.trim() : null;
  }

  private generateCommitMessage(issue: Issue): string {
    const type = issue.category === 'error' ? 'fix' : 'refactor';
    const scope = path.basename(issue.filePath, path.extname(issue.filePath));
    return `${type}(${scope}): ${issue.message.substring(0, 50)}

Issue ID: ${issue.id}
Rule: ${issue.rule ?? 'N/A'}
Source: ${issue.source}

[sloppy-automated-fix]`;
  }

  private async completeSession(message?: string): Promise<void> {
    // Create final checkpoint
    const metrics = await this.deps.metricsCollector.collectMetrics();
    await this.deps.checkpointService.createFinalCheckpoint(metrics);

    // Generate summary
    const stats = await this.deps.issueTracker.getStats();
    const summary: SessionSummary = {
      sessionId: this.session.id,
      duration: this.startTime ? Date.now() - this.startTime.getTime() : 0,
      totalIssues: stats.total,
      resolvedIssues: stats.resolved,
      failedIssues: stats.failed,
      skippedIssues: stats.skipped,
      commits: this.commits,
      verificationResults: {
        total: metrics.totalVerifications,
        passed: metrics.passedVerifications,
        failed: metrics.failedVerifications,
      },
      codeChanges: {
        filesModified: metrics.filesModified,
        linesAdded: metrics.linesAdded,
        linesRemoved: metrics.linesRemoved,
      },
      aiUsage: {
        requests: metrics.aiRequestCount,
        tokensUsed: metrics.aiTokensUsed,
        estimatedCost: metrics.aiCost,
      },
    };

    await this.updateSessionStatus('completed');

    await this.emit({
      type: 'session:completed',
      sessionId: this.session.id,
      timestamp: new Date(),
      summary,
    });

    this.logger.info('Session completed', {
      sessionId: this.session.id,
      resolved: stats.resolved,
      failed: stats.failed,
      duration: summary.duration,
    });
  }

  private async handleFatalError(error: unknown): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;

    this.logger.error('Fatal error in orchestration', {
      sessionId: this.session.id,
      error: errorMessage,
      stack: errorStack,
    });

    await this.updateSessionStatus('failed');

    await this.emit({
      type: 'session:failed',
      sessionId: this.session.id,
      timestamp: new Date(),
      error: errorMessage,
    });

    await this.emit({
      type: 'error:occurred',
      sessionId: this.session.id,
      timestamp: new Date(),
      error: errorMessage,
      stack: errorStack,
      recoverable: false,
    });
  }

  private async runGitCommand(
    args: string[],
    stdin?: string
  ): Promise<GitCommandResult> {
    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';

      const proc = spawn('git', args, {
        cwd: this.session.repositoryPath,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
        },
      });

      if (stdin) {
        proc.stdin?.write(stdin);
        proc.stdin?.end();
      }

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

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createOrchestrator(
  session: Session,
  deps: OrchestratorDependencies,
  sessionDb: SessionDatabaseAdapter,
  config?: Partial<OrchestratorConfig>
): Orchestrator {
  return new Orchestrator(session, deps, sessionDb, config);
}
