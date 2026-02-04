import { glob } from 'glob';
import {
  BaseAnalyzer,
  type Issue,
  type AnalyzerOptions,
  type AnalysisResult,
  type IssueCategory,
  type Severity,
} from './base.js';
import { StubAnalyzer } from './stubs/index.js';
import { DuplicateAnalyzer } from './duplicates/index.js';
import { BugAnalyzer } from './bugs/index.js';
import { TypeAnalyzer } from './types/index.js';
import { CoverageAnalyzer } from './coverage/index.js';
import { LintAnalyzer } from './lint/index.js';
import { SecurityAnalyzer } from './security/index.js';
import { DeadCodeAnalyzer } from './dead-code/index.js';
import { LLMAnalyzer } from './llm/index.js';

/**
 * Configuration for the orchestrator
 */
export interface OrchestratorConfig {
  /** Analyzers to run (default: all) */
  analyzers?: IssueCategory[];
  /** Maximum concurrent analyzers (default: 4) */
  concurrency?: number;
  /** Whether to deduplicate issues (default: true) */
  deduplicate?: boolean;
  /** Whether to sort by severity (default: true) */
  sortBySeverity?: boolean;
  /** Maximum issues to return (default: unlimited) */
  maxIssues?: number;
  /** Analyzer-specific configurations */
  analyzerConfigs?: Partial<Record<IssueCategory, Record<string, unknown>>>;
}

/**
 * Progress callback for analysis
 */
export type ProgressCallback = (progress: {
  analyzer: string;
  status: 'started' | 'completed' | 'failed';
  issueCount?: number;
  error?: Error;
}) => void;

/**
 * Orchestrates running multiple analyzers in parallel
 */
export class AnalysisOrchestrator {
  private readonly analyzers: Map<IssueCategory, BaseAnalyzer>;

  constructor() {
    this.analyzers = new Map<IssueCategory, BaseAnalyzer>();
    this.analyzers.set('stub', new StubAnalyzer());
    this.analyzers.set('duplicate', new DuplicateAnalyzer());
    this.analyzers.set('bug', new BugAnalyzer());
    this.analyzers.set('type', new TypeAnalyzer());
    this.analyzers.set('coverage', new CoverageAnalyzer());
    this.analyzers.set('lint', new LintAnalyzer());
    this.analyzers.set('security', new SecurityAnalyzer());
    this.analyzers.set('dead-code', new DeadCodeAnalyzer());
    this.analyzers.set('llm', new LLMAnalyzer());
  }

  /**
   * Run analysis on the given files
   */
  async analyze(
    options: AnalyzerOptions,
    config: OrchestratorConfig = {},
    onProgress?: ProgressCallback
  ): Promise<AnalysisResult> {
    const startTime = Date.now();
    const mergedConfig = this.getConfig(config);

    // Find files to analyze
    const files = await this.findFiles(options);

    if (files.length === 0) {
      return this.createEmptyResult(startTime, mergedConfig);
    }

    // Get analyzers to run
    const analyzersToRun = this.getAnalyzersToRun(mergedConfig);

    if (analyzersToRun.length === 0) {
      return this.createEmptyResult(startTime, mergedConfig);
    }

    // Run analyzers in parallel with concurrency limit
    const allIssues = await this.runAnalyzersInParallel(
      analyzersToRun,
      files,
      options,
      mergedConfig,
      onProgress
    );

    // Process results
    let issues = allIssues;

    // Deduplicate if enabled
    if (mergedConfig.deduplicate) {
      issues = this.deduplicateIssues(issues);
    }

    // Sort by severity if enabled
    if (mergedConfig.sortBySeverity) {
      issues = this.sortBySeverity(issues);
    }

    // Limit issues if configured
    if (mergedConfig.maxIssues && issues.length > mergedConfig.maxIssues) {
      issues = issues.slice(0, mergedConfig.maxIssues);
    }

    // Create result
    return this.createResult(
      issues,
      startTime,
      analyzersToRun.map((a) => a.name)
    );
  }

  /**
   * Run a single analyzer
   */
  async runAnalyzer(
    category: IssueCategory,
    options: AnalyzerOptions
  ): Promise<Issue[]> {
    const analyzer = this.analyzers.get(category);

    if (!analyzer) {
      throw new Error(`Unknown analyzer: ${category}`);
    }

    const files = await this.findFiles(options);
    return analyzer.analyze(files, options);
  }

  /**
   * Get available analyzer categories
   */
  getAvailableAnalyzers(): IssueCategory[] {
    return Array.from(this.analyzers.keys());
  }

  /**
   * Get analyzer by category
   */
  getAnalyzer(category: IssueCategory): BaseAnalyzer | undefined {
    return this.analyzers.get(category);
  }

  /**
   * Register a custom analyzer
   */
  registerAnalyzer(analyzer: BaseAnalyzer): void {
    this.analyzers.set(analyzer.category, analyzer);
  }

  /**
   * Get merged configuration with defaults
   */
  private getConfig(config: OrchestratorConfig): Omit<Required<OrchestratorConfig>, 'analyzerConfigs'> & { analyzerConfigs: Partial<Record<IssueCategory, Record<string, unknown>>> } {
    return {
      analyzers: config.analyzers ?? Array.from(this.analyzers.keys()),
      concurrency: config.concurrency ?? 4,
      deduplicate: config.deduplicate ?? true,
      sortBySeverity: config.sortBySeverity ?? true,
      maxIssues: config.maxIssues ?? 0,
      analyzerConfigs: config.analyzerConfigs ?? {},
    };
  }

  /**
   * Find files to analyze - supports ALL programming languages
   */
  private async findFiles(options: AnalyzerOptions): Promise<string[]> {
    const include = options.include ?? [
      // JavaScript/TypeScript
      '**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.mjs', '**/*.cjs',
      // Web (HTML can contain code!)
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
      // Shell
      '**/*.sh', '**/*.bash', '**/*.zsh',
      // Config (often contain logic/secrets)
      '**/*.json', '**/*.yaml', '**/*.yml', '**/*.toml', '**/*.xml',
      // SQL
      '**/*.sql',
      // Markdown
      '**/*.md',
      // Other languages
      '**/*.lua', '**/*.pl', '**/*.pm', '**/*.r', '**/*.R',
      '**/*.dart', '**/*.ex', '**/*.exs',
      '**/*.clj', '**/*.cljs',
      '**/*.hs', '**/*.ml',
      '**/*.jl', '**/*.zig', '**/*.nim',
    ];

    const exclude = options.exclude ?? [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.git/**',
      '**/coverage/**',
      '**/__pycache__/**',
      '**/venv/**',
      '**/.venv/**',
      '**/target/**',
      '**/vendor/**',
      '**/*.d.ts',
      '**/*.min.js',
      '**/*.min.css',
      '**/*.map',
      '**/*.lock',
      '**/package-lock.json',
      '**/yarn.lock',
      '**/pnpm-lock.yaml',
    ];

    const files: string[] = [];

    for (const pattern of include) {
      const matches = await glob(pattern, {
        cwd: options.rootDir,
        absolute: true,
        ignore: exclude,
        nodir: true,
      });
      files.push(...matches);
    }

    return [...new Set(files)].sort();
  }

  /**
   * Get list of analyzers to run
   */
  private getAnalyzersToRun(
    config: Required<OrchestratorConfig>
  ): BaseAnalyzer[] {
    const analyzersToRun: BaseAnalyzer[] = [];

    for (const category of config.analyzers) {
      const analyzer = this.analyzers.get(category);
      if (analyzer) {
        analyzersToRun.push(analyzer);
      }
    }

    return analyzersToRun;
  }

  /**
   * Run analyzers in parallel with concurrency limit
   */
  private async runAnalyzersInParallel(
    analyzers: BaseAnalyzer[],
    files: string[],
    options: AnalyzerOptions,
    config: Required<OrchestratorConfig>,
    onProgress?: ProgressCallback
  ): Promise<Issue[]> {
    const allIssues: Issue[] = [];
    const { concurrency, analyzerConfigs } = config;

    // Create batches based on concurrency
    const batches: BaseAnalyzer[][] = [];
    for (let i = 0; i < analyzers.length; i += concurrency) {
      batches.push(analyzers.slice(i, i + concurrency));
    }

    // Process each batch
    for (const batch of batches) {
      const batchPromises = batch.map(async (analyzer) => {
        onProgress?.({
          analyzer: analyzer.name,
          status: 'started',
        });

        try {
          // Get analyzer-specific config
          const analyzerConfig = analyzerConfigs[analyzer.category] ?? {};
          const analyzerOptions: AnalyzerOptions = {
            ...options,
            config: analyzerConfig,
          };

          const issues = await analyzer.analyze(files, analyzerOptions);

          onProgress?.({
            analyzer: analyzer.name,
            status: 'completed',
            issueCount: issues.length,
          });

          return issues;
        } catch (error) {
          onProgress?.({
            analyzer: analyzer.name,
            status: 'failed',
            error: error instanceof Error ? error : new Error(String(error)),
          });

          return [];
        }
      });

      const batchResults = await Promise.all(batchPromises);
      for (const issues of batchResults) {
        allIssues.push(...issues);
      }
    }

    return allIssues;
  }

  /**
   * Deduplicate issues based on location and message
   */
  private deduplicateIssues(issues: Issue[]): Issue[] {
    const seen = new Set<string>();
    const unique: Issue[] = [];

    for (const issue of issues) {
      // Create a key based on file, line, and message
      const key = `${issue.location.file}:${String(issue.location.line)}:${issue.message}`;

      if (!seen.has(key)) {
        seen.add(key);
        unique.push(issue);
      }
    }

    return unique;
  }

  /**
   * Sort issues by severity (errors first, then warnings, etc.)
   */
  private sortBySeverity(issues: Issue[]): Issue[] {
    const severityOrder: Record<Severity, number> = {
      error: 0,
      warning: 1,
      info: 2,
      hint: 3,
    };

    return [...issues].sort((a, b) => {
      const severityDiff = severityOrder[a.severity] - severityOrder[b.severity];

      if (severityDiff !== 0) {
        return severityDiff;
      }

      // Sort by file, then line
      const fileDiff = a.location.file.localeCompare(b.location.file);
      if (fileDiff !== 0) {
        return fileDiff;
      }

      return a.location.line - b.location.line;
    });
  }

  /**
   * Create an empty result
   */
  private createEmptyResult(
    startTime: number,
    _config: Required<OrchestratorConfig>
  ): AnalysisResult {
    return this.createResult([], startTime, []);
  }

  /**
   * Create the final analysis result
   */
  private createResult(
    issues: Issue[],
    startTime: number,
    analyzersRun: string[]
  ): AnalysisResult {
    const byCategory: Record<IssueCategory, number> = {
      stub: 0,
      duplicate: 0,
      bug: 0,
      type: 0,
      coverage: 0,
      lint: 0,
      security: 0,
      'dead-code': 0,
      llm: 0,
    };

    const bySeverity: Record<Severity, number> = {
      error: 0,
      warning: 0,
      info: 0,
      hint: 0,
    };

    for (const issue of issues) {
      byCategory[issue.category]++;
      bySeverity[issue.severity]++;
    }

    return {
      issues,
      summary: {
        total: issues.length,
        byCategory,
        bySeverity,
      },
      duration: Date.now() - startTime,
      analyzersRun,
    };
  }
}

/**
 * Convenience function to run all analyzers
 */
export async function analyze(
  rootDir: string,
  options?: Partial<AnalyzerOptions>,
  config?: OrchestratorConfig,
  onProgress?: ProgressCallback
): Promise<AnalysisResult> {
  const orchestrator = new AnalysisOrchestrator();

  const fullOptions: AnalyzerOptions = {
    rootDir,
    ...options,
  };

  return orchestrator.analyze(fullOptions, config, onProgress);
}
