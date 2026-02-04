import * as fs from 'node:fs';
import * as path from 'node:path';
import { glob } from 'glob';

/**
 * Severity levels for detected issues
 */
export type Severity = 'error' | 'warning' | 'info' | 'hint';

/**
 * Categories of issues that can be detected
 */
export type IssueCategory =
  | 'stub'
  | 'duplicate'
  | 'bug'
  | 'type'
  | 'coverage'
  | 'lint'
  | 'security'
  | 'dead-code'
  | 'llm';

/**
 * Represents a location in source code
 */
export interface SourceLocation {
  file: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
}

/**
 * Represents a detected issue in the codebase
 */
export interface Issue {
  id: string;
  category: IssueCategory;
  severity: Severity;
  message: string;
  description?: string;
  location: SourceLocation;
  context?: string;
  suggestion?: string;
  relatedLocations?: SourceLocation[];
  metadata?: Record<string, unknown>;
}

/**
 * Options for running analyzers
 */
export interface AnalyzerOptions {
  /** Root directory of the project */
  rootDir: string;
  /** Patterns to include */
  include?: string[];
  /** Patterns to exclude */
  exclude?: string[];
  /** Enable verbose logging */
  verbose?: boolean;
  /** Analyzer-specific configuration */
  config?: Record<string, unknown>;
}

/**
 * Result of reading a file
 */
export interface FileContent {
  path: string;
  content: string;
  lines: string[];
}

/**
 * Abstract base class for all analyzers
 */
export abstract class BaseAnalyzer {
  /** Unique identifier for this analyzer */
  abstract readonly name: string;

  /** Human-readable description */
  abstract readonly description: string;

  /** Category of issues this analyzer detects */
  abstract readonly category: IssueCategory;

  /** Default file patterns to analyze */
  protected readonly defaultInclude: string[] = [
    '**/*.ts',
    '**/*.tsx',
    '**/*.js',
    '**/*.jsx',
  ];

  /** Default patterns to exclude */
  protected readonly defaultExclude: string[] = [
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/.git/**',
    '**/coverage/**',
    '**/*.d.ts',
    '**/*.min.js',
  ];

  /**
   * Analyze files and return detected issues
   */
  abstract analyze(files: string[], options: AnalyzerOptions): Promise<Issue[]>;

  /**
   * Find files matching the given patterns
   */
  protected async findFiles(options: AnalyzerOptions): Promise<string[]> {
    const include = options.include ?? this.defaultInclude;
    const exclude = options.exclude ?? this.defaultExclude;

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

    // Deduplicate and sort
    return [...new Set(files)].sort();
  }

  /**
   * Read a file and return its content with line array
   */
  protected async readFile(filePath: string): Promise<FileContent | null> {
    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      return {
        path: filePath,
        content,
        lines: content.split('\n'),
      };
    } catch (error) {
      if (this.isNodeError(error) && error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Read multiple files in parallel
   */
  protected async readFiles(filePaths: string[]): Promise<FileContent[]> {
    const results = await Promise.all(
      filePaths.map((fp) => this.readFile(fp))
    );
    return results.filter((r): r is FileContent => r !== null);
  }

  /**
   * Check if a file exists
   */
  protected async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.promises.access(filePath, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get relative path from root directory
   */
  protected getRelativePath(filePath: string, rootDir: string): string {
    return path.relative(rootDir, filePath);
  }

  /**
   * Extract context (surrounding lines) from a file
   */
  protected extractContext(
    lines: string[],
    lineNumber: number,
    contextLines: number = 2
  ): string {
    const start = Math.max(0, lineNumber - contextLines - 1);
    const end = Math.min(lines.length, lineNumber + contextLines);
    return lines.slice(start, end).join('\n');
  }

  /**
   * Check if a string matches any of the given patterns
   */
  protected matchesPattern(
    str: string,
    patterns: (string | RegExp)[]
  ): boolean {
    for (const pattern of patterns) {
      if (typeof pattern === 'string') {
        if (str.includes(pattern)) {
          return true;
        }
      } else if (pattern.test(str)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Create a glob pattern from file extensions
   */
  protected extensionsToGlob(extensions: string[]): string[] {
    return extensions.map((ext) => `**/*${ext.startsWith('.') ? ext : `.${ext}`}`);
  }

  /**
   * Generate a unique issue ID
   */
  protected generateIssueId(
    category: IssueCategory,
    file: string,
    line: number,
    identifier?: string
  ): string {
    const base = `${category}:${path.basename(file)}:${line}`;
    return identifier ? `${base}:${identifier}` : base;
  }

  /**
   * Create an issue object with defaults
   */
  protected createIssue(
    partial: Omit<Issue, 'id' | 'category'> & { id?: string }
  ): Issue {
    return {
      id:
        partial.id ??
        this.generateIssueId(
          this.category,
          partial.location.file,
          partial.location.line
        ),
      category: this.category,
      ...partial,
    };
  }

  /**
   * Log a message if verbose mode is enabled
   */
  protected log(options: AnalyzerOptions, message: string): void {
    if (options.verbose) {
      console.log(`[${this.name}] ${message}`);
    }
  }

  /**
   * Log an error
   */
  protected logError(message: string, error?: unknown): void {
    console.error(`[${this.name}] ERROR: ${message}`, error);
  }

  /**
   * Type guard for Node.js errors
   */
  protected isNodeError(error: unknown): error is NodeJS.ErrnoException {
    return error instanceof Error && 'code' in error;
  }

  /**
   * Check if a line is likely a comment
   */
  protected isCommentLine(line: string): boolean {
    const trimmed = line.trim();
    return (
      trimmed.startsWith('//') ||
      trimmed.startsWith('/*') ||
      trimmed.startsWith('*') ||
      trimmed.startsWith('#')
    );
  }

  /**
   * Check if content is inside a string literal (basic heuristic)
   */
  protected isInsideString(line: string, position: number): boolean {
    let inString = false;
    let stringChar: string | null = null;
    let escaped = false;

    for (let i = 0; i < position && i < line.length; i++) {
      const char = line[i];

      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === '\\') {
        escaped = true;
        continue;
      }

      if (!inString && (char === '"' || char === "'" || char === '`')) {
        inString = true;
        stringChar = char;
      } else if (inString && char === stringChar) {
        inString = false;
        stringChar = null;
      }
    }

    return inString;
  }
}

/**
 * Result of running multiple analyzers
 */
export interface AnalysisResult {
  issues: Issue[];
  summary: {
    total: number;
    byCategory: Record<IssueCategory, number>;
    bySeverity: Record<Severity, number>;
  };
  duration: number;
  analyzersRun: string[];
}
