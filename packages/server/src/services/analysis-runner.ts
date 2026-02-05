/**
 * AnalysisRunner - Runs code analysis on sessions
 * Uses @sloppy/analyzers to detect issues and stores them in the database
 */

import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { mkdtemp, rm, readdir, readFile, writeFile } from 'node:fs/promises';
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
    this.storeActivity(session.id, 'info', 'Starting code analysis...');

    try {
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

      // Detect project language for smart analyzer selection
      let detectedLanguage = 'unknown';
      let isJsTs = false;
      try {
        const repoFiles = await readdir(localPath, { recursive: true }) as string[];
        const langResult = this.detectLanguage(repoFiles);
        detectedLanguage = langResult.primary;
        isJsTs = langResult.isJsTs;
        this.logger.info(`[analysis-runner] Detected language: ${detectedLanguage} (isJsTs: ${String(isJsTs)}, all: ${langResult.languages.join(', ')})`);
      } catch (langErr) {
        this.logger.warn(`[analysis-runner] Language detection failed: ${langErr}`);
      }

      // Get issue types from config
      const config = session.config as { issueTypes?: string[] } | null;
      const issueTypes = config?.issueTypes ?? ['lint', 'type'];

      // Map issue types to analyzer categories (language-aware)
      const analyzerCategories = this.mapIssueTypesToCategories(issueTypes, isJsTs);

      this.logger.info(`[analysis-runner] Running analyzers: ${analyzerCategories.join(', ')}`);

      wsHandler.broadcastToSession(session.id, {
        type: 'activity:log',
        data: {
          sessionId: session.id,
          type: 'info',
          message: `Detected language: ${detectedLanguage}. Running analyzers: ${analyzerCategories.join(', ')}`,
          timestamp: new Date().toISOString(),
        },
      });
      this.storeActivity(session.id, 'info', `Detected language: ${detectedLanguage}. Running analyzers: ${analyzerCategories.join(', ')}`);

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
            llm: {
              ...llmConfig,
              focusAreas: issueTypes,
              onEvent: (event: { type: string; data: Record<string, unknown> }) => {
                this.handleAnalyzerEvent(session.id, event, wsHandler);
              },
            },
          },
        },
        (progress) => {
          // Broadcast progress
          const progressType = progress.status === 'failed' ? 'error' : 'info';
          const progressMessage = `Analyzer ${progress.analyzer}: ${progress.status}${progress.issueCount !== undefined ? ` (${progress.issueCount} issues)` : ''}`;
          wsHandler.broadcastToSession(session.id, {
            type: 'activity:log',
            data: {
              sessionId: session.id,
              type: progressType,
              message: progressMessage,
              timestamp: new Date().toISOString(),
            },
          });
          this.storeActivity(session.id, progressType, progressMessage);
        }
      );

      // Check if aborted
      if (abortController.signal.aborted) {
        this.logger.info(`[analysis-runner] Analysis aborted for session ${session.id}`);
        return;
      }

      // Store issues in database
      await this.storeIssues(session.id, result);

      // Broadcast initial analysis completion
      const duration = ((Date.now() - runningAnalysis.startTime) / 1000).toFixed(1);
      this.broadcastActivity(session.id, wsHandler, 'success',
        `Analysis complete: ${result.issues.length} issues found in ${duration}s`);

      this.logger.info(`[analysis-runner] Analysis complete for session ${session.id}: ${result.issues.length} issues`);
      this.logger.info(`[analysis-runner] Analyzers run: ${result.analyzersRun.join(', ')}`);
      this.logger.info(`[analysis-runner] Summary: ${JSON.stringify(result.summary)}`);

      // Broadcast session update with new issue counts
      let stats = this.db.getSessionStats(session.id);
      wsHandler.broadcastToSession(session.id, {
        type: 'session:updated',
        data: { session: { ...session, stats }, action: 'analysis_complete' },
      });

      // If issues were found, enter fix-and-reanalyze cycle
      if (result.issues.length > 0 && !abortController.signal.aborted) {
        const maxFixCycles = 5;
        let currentIssues = result.issues;

        for (let cycle = 0; cycle < maxFixCycles; cycle++) {
          if (abortController.signal.aborted || currentIssues.length === 0) break;

          const cycleNum = cycle + 1;
          this.broadcastActivity(session.id, wsHandler, 'fixing',
            `Fix cycle ${String(cycleNum)}/${String(maxFixCycles)}: attempting to fix ${String(currentIssues.length)} issues`);

          // Fix each issue
          let fixedCount = 0;
          for (const issue of currentIssues) {
            if (abortController.signal.aborted) break;
            if (!issue.location?.file) continue;

            const filePath = join(localPath, issue.location.file);
            try {
              const fileContent = await readFile(filePath, 'utf-8');
              const fixResult = await this.generateFix(issue, fileContent, llmConfig);

              if (fixResult !== null) {
                await writeFile(filePath, fixResult, 'utf-8');
                fixedCount++;

                // Update issue status in DB
                const dbIssues = this.db.listIssuesBySession(session.id);
                const matchingIssue = dbIssues.find(
                  (di: { file_path: string; description: string }) =>
                    di.file_path === issue.location.file && di.description === issue.message
                );
                if (matchingIssue) {
                  this.db.updateIssue(matchingIssue.id, { status: 'fixed', resolved_at: new Date().toISOString() });
                  wsHandler.broadcastToSession(session.id, {
                    type: 'issue:updated',
                    data: { ...matchingIssue, status: 'fixed' },
                  });
                }

                this.broadcastActivity(session.id, wsHandler, 'success',
                  `Fixed: ${issue.message.slice(0, 80)} in ${issue.location.file}`);
              }
            } catch (fixErr) {
              const errMsg = fixErr instanceof Error ? fixErr.message : String(fixErr);
              this.logger.warn(`[analysis-runner] Failed to fix issue: ${errMsg}`);
            }
          }

          this.broadcastActivity(session.id, wsHandler, 'success',
            `Fix cycle ${String(cycleNum)} complete: fixed ${String(fixedCount)}/${String(currentIssues.length)} issues`);

          // Update stats
          stats = this.db.getSessionStats(session.id);
          wsHandler.broadcastToSession(session.id, {
            type: 'session:updated',
            data: { session: { ...session, stats }, action: 'fix_cycle_complete' },
          });

          if (fixedCount === 0) {
            this.broadcastActivity(session.id, wsHandler, 'info',
              'No issues could be fixed in this cycle, stopping');
            break;
          }

          // Re-analyze to find remaining/new issues
          if (cycle < maxFixCycles - 1 && !abortController.signal.aborted) {
            this.broadcastActivity(session.id, wsHandler, 'analyzing',
              `Re-analyzing after fixes (cycle ${String(cycleNum + 1)})...`);

            const reResult = await analyze(
              localPath,
              {
                include: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.mjs', '**/*.cjs',
                  '**/*.html', '**/*.htm', '**/*.vue', '**/*.svelte',
                  '**/*.py', '**/*.go', '**/*.rs', '**/*.java', '**/*.kt',
                  '**/*.c', '**/*.cpp', '**/*.h', '**/*.cs', '**/*.rb', '**/*.php',
                  '**/*.swift', '**/*.sh', '**/*.sql', '**/*.md'],
                exclude: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**',
                  '**/coverage/**', '**/__pycache__/**', '**/venv/**', '**/target/**',
                  '**/vendor/**', '**/*.min.js', '**/*.min.css', '**/*.lock'],
              },
              {
                analyzers: analyzerCategories as any[],
                concurrency: 4,
                deduplicate: true,
                sortBySeverity: true,
                analyzerConfigs: {
                  llm: {
                    ...llmConfig,
                    focusAreas: issueTypes,
                    onEvent: (event: { type: string; data: Record<string, unknown> }) => {
                      this.handleAnalyzerEvent(session.id, event, wsHandler);
                    },
                  },
                },
              },
              (progress) => {
                const progressType = progress.status === 'failed' ? 'error' : 'info';
                const progressMessage = `Analyzer ${progress.analyzer}: ${progress.status}${progress.issueCount !== undefined ? ` (${progress.issueCount} issues)` : ''}`;
                this.broadcastActivity(session.id, wsHandler, progressType, progressMessage);
              }
            );

            // Store new issues
            await this.storeIssues(session.id, reResult);

            this.broadcastActivity(session.id, wsHandler, 'analyzing',
              `Re-analysis found ${String(reResult.issues.length)} remaining issues`);

            currentIssues = reResult.issues;

            if (reResult.issues.length === 0) {
              this.broadcastActivity(session.id, wsHandler, 'success',
                'All issues resolved! Repository is clean.');
              break;
            }
          }
        }
      }

      // Mark session as completed
      stats = this.db.getSessionStats(session.id);
      this.db.updateSession(session.id, {
        status: 'completed',
        ended_at: new Date().toISOString(),
      });

      const completedSession = this.db.getSession(session.id);
      wsHandler.broadcastToSession(session.id, {
        type: 'session:completed',
        data: {
          session: completedSession,
          reason: stats.issuesFound === 0
            ? 'No issues found'
            : `Complete: ${String(stats.issuesResolved)} fixed, ${String(stats.issuesFound - stats.issuesResolved)} remaining`,
        },
      });
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
      this.storeActivity(session.id, 'error', `Analysis failed: ${errorMessage}`);

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
   * Detect the primary language of a codebase based on file extensions
   */
  private detectLanguage(files: string[]): { primary: string; isJsTs: boolean; languages: string[] } {
    const extCounts: Record<string, number> = {};
    const langMap: Record<string, string> = {
      '.ts': 'typescript', '.tsx': 'typescript', '.mts': 'typescript',
      '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
      '.py': 'python', '.pyw': 'python', '.pyi': 'python',
      '.go': 'go',
      '.rs': 'rust',
      '.java': 'java', '.kt': 'kotlin', '.kts': 'kotlin', '.scala': 'scala',
      '.c': 'c', '.cpp': 'cpp', '.cc': 'cpp', '.cxx': 'cpp', '.h': 'c', '.hpp': 'cpp',
      '.cs': 'csharp',
      '.rb': 'ruby', '.erb': 'ruby',
      '.php': 'php',
      '.swift': 'swift',
      '.html': 'html', '.htm': 'html',
      '.css': 'css', '.scss': 'css', '.sass': 'css', '.less': 'css',
      '.vue': 'vue', '.svelte': 'svelte',
      '.sh': 'shell', '.bash': 'shell', '.zsh': 'shell',
      '.sql': 'sql',
      '.dart': 'dart',
      '.ex': 'elixir', '.exs': 'elixir',
      '.lua': 'lua',
      '.r': 'r', '.R': 'r',
    };

    for (const file of files) {
      const ext = file.substring(file.lastIndexOf('.'));
      const lang = langMap[ext];
      if (lang) {
        extCounts[lang] = (extCounts[lang] ?? 0) + 1;
      }
    }

    const sorted = Object.entries(extCounts).sort((a, b) => b[1] - a[1]);
    const primary = sorted.length > 0 ? sorted[0][0] : 'unknown';
    const languages = sorted.map(([lang]) => lang);
    const jsTsLangs = new Set(['typescript', 'javascript', 'vue', 'svelte']);
    const isJsTs = jsTsLangs.has(primary);

    return { primary, isJsTs, languages };
  }

  /**
   * Map UI focus areas to analyzer categories.
   *
   * The LLM is now the sole orchestrator -- it decides which static analysis tools
   * to invoke internally. So we always return ['llm'] as the analyzer category.
   * The focus areas are passed to the LLM config so it knows what to prioritize.
   *
   * Fallback: if no LLM API key is available, the orchestrator itself will
   * fall back to running universal static analyzers directly.
   */
  private mapIssueTypesToCategories(_focusAreas: string[], _isJsTs: boolean = true): string[] {
    // The LLM orchestrates everything -- static analyzers are tools it invokes
    return ['llm'];
  }

  /**
   * Handle real-time events from the LLM analyzer and broadcast to WebSocket clients.
   * Converts analyzer events into activity:log events for the frontend.
   */
  private handleAnalyzerEvent(
    sessionId: string,
    event: { type: string; data: Record<string, unknown> },
    wsHandler: ReturnType<typeof getWebSocketHandler>
  ): void {
    const timestamp = new Date().toISOString();
    let activityType = 'info';
    let message = '';
    const details: Record<string, unknown> = { ...event.data, eventType: event.type };

    switch (event.type) {
      case 'llm_request_start': {
        const d = event.data as { iteration: number; maxIterations: number; provider: string; model: string };
        activityType = 'analyzing';
        message = `LLM iteration ${String(d.iteration)}/${String(d.maxIterations)} — sending to ${String(d.provider)}/${String(d.model)}`;
        break;
      }
      case 'llm_request_complete': {
        const d = event.data as { iteration: number; toolCalls?: { name: string }[]; textLength?: number; durationMs: number };
        activityType = 'analyzing';
        if (d.toolCalls && d.toolCalls.length > 0) {
          const tools = d.toolCalls.map((tc: { name: string }) => tc.name).join(', ');
          message = `Iteration ${String(d.iteration)} complete (${(d.durationMs / 1000).toFixed(1)}s) — called ${String(d.toolCalls.length)} tools: ${tools}`;
        } else {
          message = `Iteration ${String(d.iteration)} complete (${(d.durationMs / 1000).toFixed(1)}s) — text response (${String(d.textLength ?? 0)} chars)`;
        }
        break;
      }
      case 'tool_call': {
        const d = event.data as { tool: string; resultPreview: string };
        activityType = 'analyzing';
        message = `Tool ${d.tool}: ${d.resultPreview}`;
        break;
      }
      case 'issue_found': {
        const d = event.data as { title: string; severity: string; file: string };
        activityType = 'success';
        message = `Issue found [${d.severity}]: ${d.title} in ${d.file}`;
        break;
      }
      case 'analysis_complete': {
        const d = event.data as { iterations: number; llmCalls: number; issuesFound: number; durationMs: number };
        activityType = 'success';
        message = `Analysis complete: ${String(d.issuesFound)} issues in ${String(d.llmCalls)} LLM calls (${(d.durationMs / 1000).toFixed(1)}s)`;
        break;
      }
      default:
        message = `Analyzer event: ${event.type}`;
        break;
    }

    wsHandler.broadcastToSession(sessionId, {
      type: 'activity:log',
      data: {
        sessionId,
        type: activityType,
        message,
        timestamp,
        details,
      },
    });
    this.storeActivity(sessionId, activityType, message);
  }

  private storeActivity(sessionId: string, type: string, message: string): void {
    try {
      this.db.createActivity({
        session_id: sessionId,
        type,
        message,
      });
    } catch {
      // Don't let activity storage failures block analysis
    }
  }

  /**
   * Broadcast an activity event and persist it
   */
  private broadcastActivity(
    sessionId: string,
    wsHandler: ReturnType<typeof getWebSocketHandler>,
    type: string,
    message: string,
    details?: Record<string, unknown>
  ): void {
    wsHandler.broadcastToSession(sessionId, {
      type: 'activity:log',
      data: {
        sessionId,
        type,
        message,
        timestamp: new Date().toISOString(),
        ...(details && { details }),
      },
    });
    this.storeActivity(sessionId, type, message);
  }

  /**
   * Generate a fix for an issue using the LLM.
   * Returns the fixed file content, or null if the fix couldn't be generated.
   */
  private async generateFix(
    issue: { message: string; suggestion?: string; location: { file: string; line: number } },
    fileContent: string,
    llmConfig: Record<string, unknown>
  ): Promise<string | null> {
    const provider = (llmConfig.provider as string) ?? 'openai';
    const model = (llmConfig.model as string) ?? 'gpt-4o';
    const apiKey = (llmConfig.apiKey as string) ?? '';
    const baseUrl = (llmConfig.baseUrl as string) ?? '';

    if (!apiKey) return null;

    // Number file lines for context
    const lines = fileContent.split('\n');
    const numberedContent = lines.map((l, i) => `${String(i + 1).padStart(4)} | ${l}`).join('\n');

    const systemPrompt = [
      'You are an expert code fixer. You fix code issues precisely and minimally.',
      'Return ONLY the complete fixed file content. No explanations, no markdown fences, no commentary.',
      'Make the minimum change necessary to fix the issue. Preserve formatting, style, and structure.',
    ].join('\n');

    const userPrompt = [
      `Fix this issue in ${issue.location.file}:`,
      '',
      `Issue (line ${String(issue.location.line)}): ${issue.message}`,
      issue.suggestion ? `Suggestion: ${issue.suggestion}` : '',
      '',
      'File content:',
      numberedContent,
      '',
      'Return the complete fixed file content only:',
    ].filter(Boolean).join('\n');

    try {
      // Use OpenAI SDK for all providers (same as analyzer)
      const { default: OpenAI } = await import('openai');
      const client = new OpenAI({ apiKey, baseURL: baseUrl || undefined });

      const response = await client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0,
        max_tokens: 16384,
      });

      const fixedContent = response.choices[0]?.message?.content?.trim();
      if (!fixedContent || fixedContent.length < 10) return null;

      // Strip markdown fences if the LLM wrapped it anyway
      let cleaned = fixedContent;
      if (cleaned.startsWith('```')) {
        const firstNewline = cleaned.indexOf('\n');
        cleaned = cleaned.slice(firstNewline + 1);
        if (cleaned.endsWith('```')) {
          cleaned = cleaned.slice(0, -3).trimEnd();
        }
      }

      // Sanity check: the fix shouldn't be drastically different in size
      const ratio = cleaned.length / fileContent.length;
      if (ratio < 0.3 || ratio > 3.0) {
        this.logger.warn(`[analysis-runner] Fix rejected: size ratio ${ratio.toFixed(2)} too extreme`);
        return null;
      }

      return cleaned;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[analysis-runner] LLM fix generation failed: ${errMsg}`);
      return null;
    }
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
