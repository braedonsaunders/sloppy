/**
 * AnalysisRunner - Runs code analysis on sessions
 * Uses @sloppy/analyzers to detect issues and stores them in the database
 */

import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import {
  SloppyDatabase,
  type Session,
  type CreateIssueInput,
  type IssueSeverity,
  type IssueType,
} from '../db/database.js';
import { getWebSocketHandler } from '../websocket/handler.js';

// Types from @sloppy/analyzers (imported dynamically to avoid module resolution issues in dev)
interface AnalysisResult {
  issues: Array<{
    id: string;
    category: string;
    severity: string;
    message: string;
    location: {
      file: string;
      line: number;
      column: number;
      endLine?: number;
      endColumn?: number;
    };
    context?: string;
    suggestion?: string;
  }>;
  summary: {
    total: number;
    byCategory: Record<string, number>;
    bySeverity: Record<string, number>;
  };
  duration: number;
  analyzersRun: string[];
}

// Type for the analyze function from @sloppy/analyzers
type AnalyzeFn = (
  rootDir: string,
  options?: { include?: string[]; exclude?: string[] },
  config?: { analyzers?: string[]; concurrency?: number; deduplicate?: boolean; sortBySeverity?: boolean },
  onProgress?: (progress: { analyzer: string; status: string; issueCount?: number }) => void
) => Promise<AnalysisResult>;

export interface AnalysisRunnerOptions {
  db: SloppyDatabase;
  logger?: Console;
}

interface RunningAnalysis {
  sessionId: string;
  abortController: AbortController;
  startTime: number;
}

/**
 * Maps analyzer issue types to database issue types
 */
function mapIssueType(category: string): IssueType {
  const mapping: Record<string, IssueType> = {
    lint: 'lint',
    type: 'type',
    bug: 'lint', // bugs map to lint since 'bug' is not a valid IssueType
    security: 'security',
    duplicate: 'style',
    'dead-code': 'style',
    coverage: 'test',
    stub: 'lint',
    llm: 'lint', // LLM-detected issues map to lint by default (they include their own category)
  };
  return mapping[category] ?? 'lint';
}

/**
 * Maps analyzer severity to database severity
 */
function mapSeverity(severity: string): IssueSeverity {
  const mapping: Record<string, IssueSeverity> = {
    error: 'error',
    warning: 'warning',
    info: 'info',
    hint: 'info',
  };
  return mapping[severity] ?? 'info';
}

/**
 * Runs code analysis for sessions
 */
export class AnalysisRunner {
  private db: SloppyDatabase;
  private logger: Console;
  private runningAnalyses: Map<string, RunningAnalysis> = new Map();

  constructor(options: AnalysisRunnerOptions) {
    this.db = options.db;
    this.logger = options.logger ?? console;
  }

  /**
   * Start analysis for a session
   */
  async startAnalysis(session: Session): Promise<void> {
    if (this.runningAnalyses.has(session.id)) {
      throw new Error(`Analysis already running for session ${session.id}`);
    }

    const abortController = new AbortController();
    const runningAnalysis: RunningAnalysis = {
      sessionId: session.id,
      abortController,
      startTime: Date.now(),
    };
    this.runningAnalyses.set(session.id, runningAnalysis);

    this.logger.info(`[analysis-runner] Starting analysis for session ${session.id}`);
    this.logger.info(`[analysis-runner] Repository: ${session.repo_path}`);

    const wsHandler = getWebSocketHandler();

    // Broadcast analysis started
    wsHandler.broadcastToSession(session.id, {
      type: 'activity:log',
      data: {
        sessionId: session.id,
        type: 'info',
        message: 'Starting code analysis...',
        timestamp: new Date().toISOString(),
      },
    });

    try {
      // Get issue types from config
      const config = session.config as { issueTypes?: string[] } | null;
      const issueTypes = config?.issueTypes ?? ['lint', 'type'];

      // Map issue types to analyzer categories
      const analyzerCategories = this.mapIssueTypesToCategories(issueTypes);

      this.logger.info(`[analysis-runner] Running analyzers: ${analyzerCategories.join(', ')}`);

      // Broadcast analyzer info
      wsHandler.broadcastToSession(session.id, {
        type: 'activity:log',
        data: {
          sessionId: session.id,
          type: 'info',
          message: `Running analyzers: ${analyzerCategories.join(', ')}`,
          timestamp: new Date().toISOString(),
        },
      });

      // Dynamically import @sloppy/analyzers
      // Use createRequire.resolve to find the package, then dynamic import
      let analyze: AnalyzeFn;
      try {
        const require = createRequire(import.meta.url);
        const analyzerPath = require.resolve('@sloppy/analyzers');
        // Convert to file:// URL for Windows compatibility
        const analyzerUrl = pathToFileURL(analyzerPath).href;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const analyzerModule = (await import(analyzerUrl)) as any;
        analyze = analyzerModule.analyze as AnalyzeFn;
      } catch (importError) {
        const importErrorMsg = importError instanceof Error ? importError.message : String(importError);
        this.logger.error(`[analysis-runner] Failed to load analyzers: ${importErrorMsg}`);
        throw new Error(
          'Analyzers package not available. Run "pnpm build" to build all packages, then restart the server.'
        );
      }

      // Run analysis
      const result = await analyze(
        session.repo_path,
        {
          include: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
          exclude: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**'],
        },
        {
          analyzers: analyzerCategories as any[],
          concurrency: 4,
          deduplicate: true,
          sortBySeverity: true,
        },
        (progress) => {
          // Broadcast progress
          wsHandler.broadcastToSession(session.id, {
            type: 'activity:log',
            data: {
              sessionId: session.id,
              type: progress.status === 'failed' ? 'error' : 'info',
              message: `Analyzer ${progress.analyzer}: ${progress.status}${progress.issueCount !== undefined ? ` (${progress.issueCount} issues)` : ''}`,
              timestamp: new Date().toISOString(),
            },
          });
        }
      );

      // Check if aborted
      if (abortController.signal.aborted) {
        this.logger.info(`[analysis-runner] Analysis aborted for session ${session.id}`);
        return;
      }

      // Store issues in database
      await this.storeIssues(session.id, result);

      // Broadcast completion
      const duration = ((Date.now() - runningAnalysis.startTime) / 1000).toFixed(1);
      wsHandler.broadcastToSession(session.id, {
        type: 'activity:log',
        data: {
          sessionId: session.id,
          type: 'success',
          message: `Analysis complete: ${result.issues.length} issues found in ${duration}s`,
          timestamp: new Date().toISOString(),
        },
      });

      this.logger.info(`[analysis-runner] Analysis complete for session ${session.id}: ${result.issues.length} issues`);

      // Broadcast session update with new issue counts
      const stats = this.db.getSessionStats(session.id);
      wsHandler.broadcastToSession(session.id, {
        type: 'session:updated',
        data: {
          session: { ...session, stats },
          action: 'analysis_complete',
        },
      });

      // If no issues found, mark session as completed
      if (result.issues.length === 0) {
        this.db.updateSession(session.id, {
          status: 'completed',
          ended_at: new Date().toISOString(),
        });

        wsHandler.broadcastToSession(session.id, {
          type: 'session:completed',
          data: {
            session: this.db.getSession(session.id),
            reason: 'No issues found',
          },
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`[analysis-runner] Analysis failed for session ${session.id}: ${errorMessage}`);

      // Broadcast error
      wsHandler.broadcastToSession(session.id, {
        type: 'activity:log',
        data: {
          sessionId: session.id,
          type: 'error',
          message: `Analysis failed: ${errorMessage}`,
          timestamp: new Date().toISOString(),
        },
      });

      // Mark session as failed
      this.db.updateSession(session.id, {
        status: 'failed',
        ended_at: new Date().toISOString(),
      });

      wsHandler.broadcastToSession(session.id, {
        type: 'session:failed',
        data: {
          session: this.db.getSession(session.id),
          error: errorMessage,
        },
      });
    } finally {
      this.runningAnalyses.delete(session.id);
    }
  }

  /**
   * Stop analysis for a session
   */
  stopAnalysis(sessionId: string): void {
    const running = this.runningAnalyses.get(sessionId);
    if (running) {
      running.abortController.abort();
      this.runningAnalyses.delete(sessionId);
      this.logger.info(`[analysis-runner] Stopped analysis for session ${sessionId}`);
    }
  }

  /**
   * Check if analysis is running for a session
   */
  isAnalysisRunning(sessionId: string): boolean {
    return this.runningAnalyses.has(sessionId);
  }

  /**
   * Map UI issue types to analyzer categories
   */
  private mapIssueTypesToCategories(issueTypes: string[]): string[] {
    const mapping: Record<string, string[]> = {
      lint: ['lint'],
      type: ['type'],
      test: ['coverage'],
      security: ['security'],
      performance: ['bug'],
      style: ['duplicate', 'dead-code'],
      llm: ['llm'], // LLM-powered deep analysis
      ai: ['llm'], // Alias for llm
      deep: ['llm'], // Alias for deep analysis
    };

    const categories: Set<string> = new Set();
    for (const type of issueTypes) {
      const mapped = mapping[type];
      if (mapped) {
        for (const cat of mapped) {
          categories.add(cat);
        }
      }
    }

    // Always include lint as a baseline
    if (categories.size === 0) {
      categories.add('lint');
    }

    return Array.from(categories);
  }

  /**
   * Store analysis issues in the database
   */
  private async storeIssues(sessionId: string, result: AnalysisResult): Promise<void> {
    const wsHandler = getWebSocketHandler();

    for (const issue of result.issues) {
      const input: CreateIssueInput = {
        session_id: sessionId,
        type: mapIssueType(issue.category),
        severity: mapSeverity(issue.severity),
        file_path: issue.location.file,
        line_start: issue.location.line,
        line_end: issue.location.endLine ?? issue.location.line,
        description: issue.message,
        context: issue.suggestion ? { suggestion: issue.suggestion, context: issue.context } : undefined,
      };

      const createdIssue = this.db.createIssue(input);

      // Broadcast new issue
      wsHandler.broadcastToSession(sessionId, {
        type: 'issue:created',
        data: { issue: createdIssue },
      });
    }
  }

  /**
   * Shutdown - stop all running analyses
   */
  async shutdown(): Promise<void> {
    this.logger.info('[analysis-runner] Shutting down...');
    for (const sessionId of this.runningAnalyses.keys()) {
      this.stopAnalysis(sessionId);
    }
    this.logger.info('[analysis-runner] Shutdown complete');
  }
}

// Singleton instance
let analysisRunner: AnalysisRunner | null = null;

export function getAnalysisRunner(options?: AnalysisRunnerOptions): AnalysisRunner {
  if (!analysisRunner) {
    if (!options) {
      throw new Error('AnalysisRunner not initialized. Provide options on first call.');
    }
    analysisRunner = new AnalysisRunner(options);
  }
  return analysisRunner;
}

export function closeAnalysisRunner(): Promise<void> {
  if (analysisRunner) {
    const runner = analysisRunner;
    analysisRunner = null;
    return runner.shutdown();
  }
  return Promise.resolve();
}
