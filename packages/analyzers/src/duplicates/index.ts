// Define interfaces locally since jscpd doesn't export them properly
// Note: jscpd is imported dynamically in analyze() to avoid ESM compatibility issues
interface IClone {
  format: string;
  duplicationA: {
    sourceId: string;
    start: { line: number; column?: number };
    end: { line: number; column?: number };
    fragment?: string;
  };
  duplicationB: {
    sourceId: string;
    start: { line: number; column?: number };
    end: { line: number; column?: number };
    fragment?: string;
  };
}

interface IOptions {
  path?: string[];
  minLines?: number;
  minTokens?: number;
  maxSize?: string;
  maxLines?: number;
  format?: string[];
  ignore?: string[];
  reporters?: string[];
  output?: string;
  silent?: boolean;
  absolute?: boolean;
  noSymlinks?: boolean;
  skipLocal?: boolean;
  threshold?: number;
}
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import {
  BaseAnalyzer,
  type Issue,
  type AnalyzerOptions,
  type SourceLocation,
} from '../base.js';

/**
 * Configuration options for duplicate detection
 */
export interface DuplicateAnalyzerConfig {
  /** Minimum number of lines to consider as duplicate (default: 5) */
  minLines?: number;
  /** Minimum number of tokens to consider as duplicate (default: 50) */
  minTokens?: number;
  /** Maximum number of files to analyze (default: 1000) */
  maxFiles?: number;
  /** Formats to analyze (default: typescript, javascript, tsx, jsx) */
  formats?: string[];
  /** Ignore patterns for duplicate detection */
  ignorePatterns?: string[];
  /** Threshold percentage for similarity (default: 0) */
  threshold?: number;
}

/**
 * Represents a group of duplicate code locations
 */
export interface DuplicateGroup {
  /** Hash identifying this duplicate pattern */
  hash: string;
  /** Number of lines duplicated */
  lines: number;
  /** Number of tokens duplicated */
  tokens: number;
  /** All locations where this duplicate appears */
  locations: SourceLocation[];
  /** Sample of the duplicated code */
  fragment?: string;
}

/**
 * Analyzer for detecting duplicate/copy-paste code
 */
export class DuplicateAnalyzer extends BaseAnalyzer {
  readonly name = 'duplicate-analyzer';
  readonly description = 'Detects copy-paste and duplicate code patterns';
  readonly category = 'duplicate' as const;

  private readonly defaultConfig: Required<DuplicateAnalyzerConfig> = {
    minLines: 5,
    minTokens: 50,
    maxFiles: 1000,
    formats: ['typescript', 'javascript', 'tsx', 'jsx'],
    ignorePatterns: ['**/node_modules/**', '**/dist/**', '**/*.d.ts'],
    threshold: 0,
  };

  async analyze(files: string[], options: AnalyzerOptions): Promise<Issue[]> {
    const config = this.getConfig(options);
    const issues: Issue[] = [];

    try {
      // Create a temporary directory for jscpd to work with
      const tempDir = await this.createTempReport();

      // Configure jscpd options
      const jscpdOptions: IOptions = {
        path: [options.rootDir],
        minLines: config.minLines,
        minTokens: config.minTokens,
        maxSize: '100kb',
        maxLines: 1000,
        format: config.formats,
        ignore: config.ignorePatterns,
        reporters: ['json'],
        output: tempDir,
        silent: true,
        absolute: true,
        noSymlinks: true,
        skipLocal: false,
        threshold: config.threshold,
      };

      this.log(options, `Running duplicate detection with minLines=${String(config.minLines)}, minTokens=${String(config.minTokens)}`);

      // Dynamically import jscpd to avoid ESM compatibility issues at module load time
      const { detectClones } = await import('jscpd');

      // Run jscpd detection
      const clones = await detectClones(jscpdOptions);

      // Group clones by their content hash
      const groups = this.groupClones(clones);

      // Convert grouped clones to issues
      for (const group of groups) {
        const groupIssues = this.createIssuesFromGroup(group, options);
        issues.push(...groupIssues);
      }

      // Cleanup temp directory
      await this.cleanupTempDir(tempDir);

      this.log(options, `Found ${String(groups.length)} duplicate code groups with ${String(issues.length)} total issues`);
    } catch (error) {
      this.logError('Failed to run duplicate detection', error);
    }

    return issues;
  }

  /**
   * Get configuration from options
   */
  private getConfig(options: AnalyzerOptions): Required<DuplicateAnalyzerConfig> {
    const userConfig = options.config as DuplicateAnalyzerConfig | undefined;
    return {
      minLines: userConfig?.minLines ?? this.defaultConfig.minLines,
      minTokens: userConfig?.minTokens ?? this.defaultConfig.minTokens,
      maxFiles: userConfig?.maxFiles ?? this.defaultConfig.maxFiles,
      formats: userConfig?.formats ?? this.defaultConfig.formats,
      ignorePatterns: userConfig?.ignorePatterns ?? this.defaultConfig.ignorePatterns,
      threshold: userConfig?.threshold ?? this.defaultConfig.threshold,
    };
  }

  /**
   * Create a temporary directory for jscpd reports
   */
  private async createTempReport(): Promise<string> {
    const tempDir = path.join(os.tmpdir(), `sloppy-jscpd-${String(Date.now())}`);
    await fs.promises.mkdir(tempDir, { recursive: true });
    return tempDir;
  }

  /**
   * Cleanup temporary directory
   */
  private async cleanupTempDir(tempDir: string): Promise<void> {
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }

  /**
   * Group clones by their format/content hash
   */
  private groupClones(clones: IClone[]): DuplicateGroup[] {
    const groupMap = new Map<string, DuplicateGroup>();

    for (const clone of clones) {
      // Create a unique key for this duplicate pattern
      const key = `${clone.format}-${clone.duplicationA.sourceId}-${String(clone.duplicationA.start.line)}`;

      if (!groupMap.has(key)) {
        const group: DuplicateGroup = {
          hash: key,
          lines: clone.duplicationA.end.line - clone.duplicationA.start.line + 1,
          tokens: clone.duplicationA.end.column ?? 0, // Approximation using column as token count
          locations: [],
          fragment: clone.duplicationA.fragment,
        };
        groupMap.set(key, group);
      }

      const group = groupMap.get(key);
      if (group === undefined) {continue;}

      // Add both locations from this clone pair
      const locA: SourceLocation = {
        file: clone.duplicationA.sourceId,
        line: clone.duplicationA.start.line,
        column: clone.duplicationA.start.column ?? 1,
        endLine: clone.duplicationA.end.line,
        endColumn: clone.duplicationA.end.column ?? 1,
      };

      const locB: SourceLocation = {
        file: clone.duplicationB.sourceId,
        line: clone.duplicationB.start.line,
        column: clone.duplicationB.start.column ?? 1,
        endLine: clone.duplicationB.end.line,
        endColumn: clone.duplicationB.end.column ?? 1,
      };

      // Add locations if not already present
      if (!this.hasLocation(group.locations, locA)) {
        group.locations.push(locA);
      }
      if (!this.hasLocation(group.locations, locB)) {
        group.locations.push(locB);
      }
    }

    // Filter out groups with only one location (shouldn't happen, but be safe)
    return Array.from(groupMap.values()).filter((g) => g.locations.length > 1);
  }

  /**
   * Check if a location is already in the list
   */
  private hasLocation(locations: SourceLocation[], loc: SourceLocation): boolean {
    return locations.some(
      (l) => l.file === loc.file && l.line === loc.line && l.column === loc.column
    );
  }

  /**
   * Create issues from a duplicate group
   */
  private createIssuesFromGroup(
    group: DuplicateGroup,
    options: AnalyzerOptions
  ): Issue[] {
    const issues: Issue[] = [];
    const severity = this.calculateSeverity(group);

    // Create an issue for the first location, referencing all others
    const primaryLocation = group.locations[0];
    const relatedLocations = group.locations.slice(1);

    // Create description with all duplicate locations
    const locationDescriptions = group.locations
      .map((loc) => `  - ${this.getRelativePath(loc.file, options.rootDir)}:${String(loc.line)}`)
      .join('\n');

    const description = `This code block (${String(group.lines)} lines) is duplicated in ${String(group.locations.length)} locations:\n${locationDescriptions}`;

    // Create a truncated fragment preview
    const fragmentPreview = group.fragment !== undefined && group.fragment !== ''
      ? this.truncateFragment(group.fragment, 200)
      : undefined;

    issues.push(
      this.createIssue({
        id: `duplicate:${group.hash}`,
        severity,
        message: `Duplicate code found (${String(group.lines)} lines, ${String(group.locations.length)} occurrences)`,
        description,
        location: primaryLocation,
        context: fragmentPreview,
        suggestion: 'Consider extracting this code into a shared function or module',
        relatedLocations,
        metadata: {
          hash: group.hash,
          lines: group.lines,
          tokens: group.tokens,
          occurrences: group.locations.length,
        },
      })
    );

    return issues;
  }

  /**
   * Calculate severity based on duplicate size and count
   */
  private calculateSeverity(group: DuplicateGroup): 'error' | 'warning' | 'info' {
    const { lines, locations } = group;

    // Large duplicates (> 20 lines) or many occurrences (> 3) are errors
    if (lines > 20 || locations.length > 3) {
      return 'error';
    }

    // Medium duplicates (> 10 lines) or multiple occurrences (> 2) are warnings
    if (lines > 10 || locations.length > 2) {
      return 'warning';
    }

    return 'info';
  }

  /**
   * Truncate fragment to a maximum length
   */
  private truncateFragment(fragment: string, maxLength: number): string {
    if (fragment.length <= maxLength) {
      return fragment;
    }
    return fragment.slice(0, maxLength) + '\n... (truncated)';
  }
}
