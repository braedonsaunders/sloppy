/**
 * AnalysisRunner - Runs code analysis on sessions
 * Uses @sloppy/analyzers to detect issues and stores them in the database
 */

import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';
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
  config?: {
    analyzers?: string[];
    concurrency?: number;
    deduplicate?: boolean;
    sortBySeverity?: boolean;
    analyzerConfigs?: Record<string, Record<string, unknown>>;
  },
  onProgress?: (progress: { analyzer: string; status: string; issueCount?: number }) => void
) => Promise<AnalysisResult>;

// Provider row type from database
interface ProviderRow {
  id: string;
  name: string;
  api_key: string | null;
  base_url: string | null;
  models: string;
  configured: number;
  options: string;
  selected_model: string | null;
}

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

      // Get LLM config from database
      const llmConfig = this.getLLMConfig(session);
      this.logger.info(`[analysis-runner] LLM config: provider=${llmConfig.provider ?? 'none'}, apiKey=${llmConfig.apiKey ? 'present' : 'MISSING'}, model=${llmConfig.model ?? 'default'}`);

      // Resolve repo path - clone if it's a URL
      const { localPath, tempDir } = await this.resolveRepoPath(session.repo_path, session.id, wsHandler);

      this.logger.info(`[analysis-runner] Analysis path: ${localPath}`);
      wsHandler.broadcastToSession(session.id, {
        type: 'activity:log',
        data: {
          sessionId: session.id,
          type: 'info',
          message: `Analyzing path: ${localPath}`,
          timestamp: new Date().toISOString(),
        },
      });

      try {
        // Run analysis with comprehensive file patterns for ALL languages
        const result = await analyze(
          localPath,
        {
          include: [
            // JavaScript/TypeScript ecosystem
            '**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.mjs', '**/*.cjs',
            // Web files (HTML can contain JS!)
            '**/*.html', '**/*.htm', '**/*.vue', '**/*.svelte', '**/*.astro',
            // Stylesheets
            '**/*.css', '**/*.scss', '**/*.sass', '**/*.less',
            // Python
            '**/*.py', '**/*.pyw', '**/*.pyi',
            // Go
            '**/*.go',
            // Rust
            '**/*.rs',
            // Java/Kotlin/Scala
            '**/*.java', '**/*.kt', '**/*.kts', '**/*.scala',
            // C/C++/C#
            '**/*.c', '**/*.cpp', '**/*.cc', '**/*.cxx', '**/*.h', '**/*.hpp', '**/*.cs',
            // Ruby
            '**/*.rb', '**/*.erb',
            // PHP
            '**/*.php',
            // Swift/Objective-C
            '**/*.swift', '**/*.m', '**/*.mm',
            // Shell scripts
            '**/*.sh', '**/*.bash', '**/*.zsh',
            // Config/Data files (often contain logic or security issues)
            '**/*.json', '**/*.yaml', '**/*.yml', '**/*.toml', '**/*.xml',
            // SQL
            '**/*.sql',
            // Markdown (docs can reveal architecture)
            '**/*.md',
            // Docker/Infrastructure
            '**/Dockerfile', '**/docker-compose.yml', '**/docker-compose.yaml',
            '**/*.tf', '**/*.hcl',
            // Other languages
            '**/*.lua', '**/*.pl', '**/*.pm', '**/*.r', '**/*.R',
            '**/*.dart', '**/*.ex', '**/*.exs', '**/*.erl', '**/*.hrl',
            '**/*.zig', '**/*.nim', '**/*.v', '**/*.d',
            '**/*.clj', '**/*.cljs', '**/*.cljc', '**/*.edn',
            '**/*.fs', '**/*.fsx', '**/*.fsi',
            '**/*.hs', '**/*.lhs',
            '**/*.ml', '**/*.mli',
            '**/*.jl',
          ],
          exclude: [
            '**/node_modules/**',
            '**/dist/**',
            '**/build/**',
            '**/.git/**',
            '**/coverage/**',
            '**/__pycache__/**',
            '**/*.pyc',
            '**/venv/**',
            '**/.venv/**',
            '**/target/**',        // Rust/Java build output
            '**/vendor/**',        // Go/PHP dependencies
            '**/.next/**',
            '**/.nuxt/**',
            '**/out/**',
            '**/*.min.js',
            '**/*.min.css',
            '**/*.map',
            '**/*.lock',           // Lock files
            '**/package-lock.json',
            '**/yarn.lock',
            '**/pnpm-lock.yaml',
            '**/Cargo.lock',
            '**/poetry.lock',
            '**/Gemfile.lock',
            '**/go.sum',
          ],
        },
        {
          analyzers: analyzerCategories as any[],
          concurrency: 4,
          deduplicate: true,
          sortBySeverity: true,
          analyzerConfigs: {
            llm: llmConfig,
          },
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
      this.logger.info(`[analysis-runner] Analyzers run: ${result.analyzersRun.join(', ')}`);
      this.logger.info(`[analysis-runner] Summary: ${JSON.stringify(result.summary)}`);

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
      } finally {
        // Clean up temp directory if we cloned
        if (tempDir) {
          try {
            await rm(tempDir, { recursive: true, force: true });
            this.logger.info(`[analysis-runner] Cleaned up temp directory: ${tempDir}`);
          } catch (cleanupError) {
            this.logger.warn(`[analysis-runner] Failed to clean up temp directory: ${tempDir}`);
          }
        }
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
   * Resolve repository path - clone if it's a URL, otherwise use directly
   */
  private async resolveRepoPath(
    repoPath: string,
    sessionId: string,
    wsHandler: ReturnType<typeof getWebSocketHandler>
  ): Promise<{ localPath: string; tempDir: string | null }> {
    // Check if it's a URL (GitHub, GitLab, etc.)
    const isUrl = repoPath.startsWith('http://') ||
                  repoPath.startsWith('https://') ||
                  repoPath.startsWith('git@');

    if (!isUrl) {
      // Local path - use directly
      return { localPath: repoPath, tempDir: null };
    }

    // It's a URL - need to clone
    this.logger.info(`[analysis-runner] Cloning repository: ${repoPath}`);
    wsHandler.broadcastToSession(sessionId, {
      type: 'activity:log',
      data: {
        sessionId,
        type: 'info',
        message: 'Cloning repository...',
        timestamp: new Date().toISOString(),
      },
    });

    // Create temp directory
    const tempDir = await mkdtemp(join(tmpdir(), 'sloppy-'));
    const localPath = join(tempDir, 'repo');

    try {
      // Use simpleGit directly since the target directory doesn't exist yet
      await simpleGit().clone(repoPath, localPath);
      this.logger.info(`[analysis-runner] Cloned to: ${localPath}`);

      // List directory contents for debugging
      try {
        const files = await readdir(localPath);
        this.logger.info(`[analysis-runner] Repo contents (top-level): ${files.join(', ')}`);

        // Check for common source directories
        for (const dir of ['src', 'lib', 'app', 'packages']) {
          if (files.includes(dir)) {
            const subFiles = await readdir(join(localPath, dir));
            this.logger.info(`[analysis-runner] ${dir}/ contents: ${subFiles.slice(0, 10).join(', ')}${subFiles.length > 10 ? '...' : ''}`);
          }
        }
      } catch (listError) {
        this.logger.warn(`[analysis-runner] Could not list directory: ${listError}`);
      }

      wsHandler.broadcastToSession(sessionId, {
        type: 'activity:log',
        data: {
          sessionId,
          type: 'success',
          message: 'Repository cloned successfully',
          timestamp: new Date().toISOString(),
        },
      });

      return { localPath, tempDir };
    } catch (error) {
      // Clean up temp dir on failure
      try {
        await rm(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
      throw new Error(`Failed to clone repository: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get LLM analyzer configuration from the database
   * Fetches the configured provider's API key and settings
   */
  private getLLMConfig(session: Session): Record<string, unknown> {
    const rawDb = this.db.getRawDb();

    // Check if session has provider_config (stored as JSON string in database)
    let sessionConfig: { providerId?: string; model?: string } | null = null;
    try {
      const parsed = JSON.parse(session.provider_config || '{}');
      sessionConfig = parsed;
    } catch {
      // Ignore parse errors
    }
    let providerId = sessionConfig?.providerId;

    // Fallback to default provider from settings
    if (!providerId) {
      const settingStmt = rawDb.prepare('SELECT value FROM settings WHERE key = ?');
      const defaultProviderRow = settingStmt.get('defaultProvider') as { value: string } | undefined;
      if (defaultProviderRow) {
        try {
          providerId = JSON.parse(defaultProviderRow.value) as string;
        } catch {
          providerId = 'claude'; // Fallback
        }
      } else {
        providerId = 'claude';
      }
    }

    // Fetch provider config from database
    const providerStmt = rawDb.prepare(`
      SELECT id, name, api_key, base_url, models, configured, options, selected_model
      FROM providers
      WHERE id = ?
    `);
    const provider = providerStmt.get(providerId) as ProviderRow | undefined;

    if (!provider) {
      this.logger.warn(`[analysis-runner] Provider '${providerId}' not found in database`);
      return {};
    }

    if (!provider.api_key && providerId !== 'ollama') {
      this.logger.warn(`[analysis-runner] No API key configured for provider '${providerId}'. LLM analysis will be skipped.`);
      return {};
    }

    // Get model - from session config, provider's selected model, or default
    let model = sessionConfig?.model ?? provider.selected_model;
    if (!model) {
      const modelSettingStmt = rawDb.prepare('SELECT value FROM settings WHERE key = ?');
      const defaultModelRow = modelSettingStmt.get('defaultModel') as { value: string } | undefined;
      if (defaultModelRow) {
        try {
          model = JSON.parse(defaultModelRow.value) as string;
        } catch {
          // Use provider default
        }
      }
    }

    this.logger.info(`[analysis-runner] Using LLM provider: ${providerId}, model: ${model ?? 'default'}`);

    return {
      apiKey: provider.api_key,
      provider: providerId,
      model: model ?? undefined,
      baseUrl: provider.base_url ?? undefined,
    };
  }

  /**
   * Map UI focus areas to analyzer categories
   * LLM is ALWAYS included - it orchestrates the entire analysis
   * Focus areas tell the LLM what to prioritize
   */
  private mapIssueTypesToCategories(focusAreas: string[]): string[] {
    // LLM is always the primary orchestrator
    const categories: Set<string> = new Set(['llm']);

    // Also run fast static analyzers in parallel for quick wins
    const staticAnalyzers: Record<string, string[]> = {
      lint: ['lint'],
      type: ['type'],
      test: ['coverage'],
      security: ['security'],
      stubs: ['stub'],
      maintainability: ['duplicate', 'dead-code'],
    };

    for (const area of focusAreas) {
      const mapped = staticAnalyzers[area];
      if (mapped) {
        for (const cat of mapped) {
          categories.add(cat);
        }
      }
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
