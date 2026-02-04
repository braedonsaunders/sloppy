import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  BaseAnalyzer,
  type Issue,
  type AnalyzerOptions,
  type SourceLocation,
  type Severity,
} from '../base.js';

/**
 * LCOV record for a source file
 */
interface LcovRecord {
  file: string;
  lines: {
    found: number;
    hit: number;
    details: Array<{ line: number; hit: number }>;
  };
  functions: {
    found: number;
    hit: number;
    details: Array<{ name: string; line: number; hit: number }>;
  };
  branches: {
    found: number;
    hit: number;
    details: Array<{ line: number; block: number; branch: number; taken: number }>;
  };
}

/**
 * Istanbul JSON coverage format
 */
interface IstanbulCoverage {
  [filePath: string]: {
    path: string;
    statementMap: Record<string, { start: { line: number; column: number }; end: { line: number; column: number } }>;
    fnMap: Record<string, { name: string; decl: { start: { line: number; column: number }; end: { line: number; column: number } }; loc: { start: { line: number; column: number }; end: { line: number; column: number } } }>;
    branchMap: Record<string, { loc: { start: { line: number; column: number }; end: { line: number; column: number } }; type: string; locations: Array<{ start: { line: number; column: number }; end: { line: number; column: number } }> }>;
    s: Record<string, number>;
    f: Record<string, number>;
    b: Record<string, number[]>;
  };
}

/**
 * Parsed coverage data for a file
 */
interface FileCoverage {
  file: string;
  lineCoverage: number;
  functionCoverage: number;
  branchCoverage: number;
  uncoveredLines: number[];
  uncoveredFunctions: Array<{ name: string; line: number }>;
  uncoveredBranches: Array<{ line: number; branch: number }>;
}

/**
 * Configuration for coverage analysis
 */
export interface CoverageAnalyzerConfig {
  /** Path to coverage report file */
  coveragePath?: string;
  /** Coverage format (auto-detected if not specified) */
  format?: 'lcov' | 'istanbul';
  /** Minimum line coverage threshold (default: 80) */
  lineThreshold?: number;
  /** Minimum function coverage threshold (default: 80) */
  functionThreshold?: number;
  /** Minimum branch coverage threshold (default: 70) */
  branchThreshold?: number;
  /** Report zero-coverage functions (default: true) */
  reportZeroCoverageFunctions?: boolean;
}

/**
 * Analyzer for detecting coverage issues
 */
export class CoverageAnalyzer extends BaseAnalyzer {
  readonly name = 'coverage-analyzer';
  readonly description = 'Analyzes test coverage and reports uncovered code';
  readonly category = 'coverage' as const;

  private readonly defaultCoveragePaths = [
    'coverage/lcov.info',
    'coverage/lcov-report/lcov.info',
    'coverage/coverage-final.json',
    'coverage/coverage.json',
  ];

  async analyze(files: string[], options: AnalyzerOptions): Promise<Issue[]> {
    const issues: Issue[] = [];
    const config = this.getConfig(options);

    try {
      // Find coverage file
      const coveragePath = await this.findCoverageFile(options.rootDir, config);

      if (!coveragePath) {
        this.log(options, 'No coverage report found');
        return issues;
      }

      this.log(options, `Found coverage report: ${coveragePath}`);

      // Parse coverage file
      const coverageData = await this.parseCoverageFile(coveragePath, config);

      if (coverageData.length === 0) {
        this.log(options, 'No coverage data found in report');
        return issues;
      }

      // Analyze coverage data
      for (const fileCoverage of coverageData) {
        const fileIssues = this.analyzeFileCoverage(fileCoverage, config, options);
        issues.push(...fileIssues);
      }

      this.log(options, `Analyzed coverage for ${coverageData.length} files, found ${issues.length} coverage issues`);
    } catch (error) {
      this.logError('Failed to analyze coverage', error);
    }

    return issues;
  }

  /**
   * Get configuration from options
   */
  private getConfig(options: AnalyzerOptions): Required<CoverageAnalyzerConfig> {
    const userConfig = options.config as CoverageAnalyzerConfig | undefined;
    return {
      coveragePath: userConfig?.coveragePath ?? '',
      format: userConfig?.format ?? 'lcov',
      lineThreshold: userConfig?.lineThreshold ?? 80,
      functionThreshold: userConfig?.functionThreshold ?? 80,
      branchThreshold: userConfig?.branchThreshold ?? 70,
      reportZeroCoverageFunctions: userConfig?.reportZeroCoverageFunctions ?? true,
    };
  }

  /**
   * Find coverage file in the project
   */
  private async findCoverageFile(
    rootDir: string,
    config: Required<CoverageAnalyzerConfig>
  ): Promise<string | null> {
    // Use configured path if provided
    if (config.coveragePath) {
      const fullPath = path.isAbsolute(config.coveragePath)
        ? config.coveragePath
        : path.join(rootDir, config.coveragePath);

      if (await this.fileExists(fullPath)) {
        return fullPath;
      }
    }

    // Try default paths
    for (const relativePath of this.defaultCoveragePaths) {
      const fullPath = path.join(rootDir, relativePath);
      if (await this.fileExists(fullPath)) {
        return fullPath;
      }
    }

    return null;
  }

  /**
   * Parse coverage file
   */
  private async parseCoverageFile(
    coveragePath: string,
    config: Required<CoverageAnalyzerConfig>
  ): Promise<FileCoverage[]> {
    const content = await fs.promises.readFile(coveragePath, 'utf-8');

    // Auto-detect format
    if (coveragePath.endsWith('.json') || content.trim().startsWith('{')) {
      return this.parseIstanbulCoverage(content);
    }

    return this.parseLcovCoverage(content);
  }

  /**
   * Parse LCOV format coverage
   */
  private parseLcovCoverage(content: string): FileCoverage[] {
    const records: LcovRecord[] = [];
    let currentRecord: LcovRecord | null = null;

    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed.startsWith('SF:')) {
        // Source file
        currentRecord = {
          file: trimmed.slice(3),
          lines: { found: 0, hit: 0, details: [] },
          functions: { found: 0, hit: 0, details: [] },
          branches: { found: 0, hit: 0, details: [] },
        };
      } else if (trimmed === 'end_of_record' && currentRecord) {
        records.push(currentRecord);
        currentRecord = null;
      } else if (currentRecord) {
        this.parseLcovLine(trimmed, currentRecord);
      }
    }

    return records.map((record) => this.lcovToFileCoverage(record));
  }

  /**
   * Parse a single LCOV line
   */
  private parseLcovLine(line: string, record: LcovRecord): void {
    const [key, value] = line.split(':');

    if (!key || !value) {
      return;
    }

    switch (key) {
      case 'LF': // Lines found
        record.lines.found = parseInt(value, 10);
        break;
      case 'LH': // Lines hit
        record.lines.hit = parseInt(value, 10);
        break;
      case 'DA': {
        // Line data: line_number,execution_count
        const [lineNum, hitCount] = value.split(',').map(Number);
        if (lineNum !== undefined && hitCount !== undefined) {
          record.lines.details.push({ line: lineNum, hit: hitCount });
        }
        break;
      }
      case 'FNF': // Functions found
        record.functions.found = parseInt(value, 10);
        break;
      case 'FNH': // Functions hit
        record.functions.hit = parseInt(value, 10);
        break;
      case 'FN': {
        // Function: line_number,function_name
        const [fnLine, fnName] = value.split(',');
        if (fnLine && fnName) {
          record.functions.details.push({
            name: fnName,
            line: parseInt(fnLine, 10),
            hit: 0,
          });
        }
        break;
      }
      case 'FNDA': {
        // Function data: execution_count,function_name
        const [execCount, funcName] = value.split(',');
        if (execCount && funcName) {
          const func = record.functions.details.find((f) => f.name === funcName);
          if (func) {
            func.hit = parseInt(execCount, 10);
          }
        }
        break;
      }
      case 'BRF': // Branches found
        record.branches.found = parseInt(value, 10);
        break;
      case 'BRH': // Branches hit
        record.branches.hit = parseInt(value, 10);
        break;
      case 'BRDA': {
        // Branch data: line_number,block_number,branch_number,taken
        const parts = value.split(',');
        if (parts.length >= 4) {
          record.branches.details.push({
            line: parseInt(parts[0] ?? '0', 10),
            block: parseInt(parts[1] ?? '0', 10),
            branch: parseInt(parts[2] ?? '0', 10),
            taken: parts[3] === '-' ? 0 : parseInt(parts[3] ?? '0', 10),
          });
        }
        break;
      }
    }
  }

  /**
   * Convert LCOV record to FileCoverage
   */
  private lcovToFileCoverage(record: LcovRecord): FileCoverage {
    const lineCoverage = record.lines.found > 0
      ? (record.lines.hit / record.lines.found) * 100
      : 100;

    const functionCoverage = record.functions.found > 0
      ? (record.functions.hit / record.functions.found) * 100
      : 100;

    const branchCoverage = record.branches.found > 0
      ? (record.branches.hit / record.branches.found) * 100
      : 100;

    const uncoveredLines = record.lines.details
      .filter((d) => d.hit === 0)
      .map((d) => d.line);

    const uncoveredFunctions = record.functions.details
      .filter((d) => d.hit === 0)
      .map((d) => ({ name: d.name, line: d.line }));

    const uncoveredBranches = record.branches.details
      .filter((d) => d.taken === 0)
      .map((d) => ({ line: d.line, branch: d.branch }));

    return {
      file: record.file,
      lineCoverage,
      functionCoverage,
      branchCoverage,
      uncoveredLines,
      uncoveredFunctions,
      uncoveredBranches,
    };
  }

  /**
   * Parse Istanbul JSON format coverage
   */
  private parseIstanbulCoverage(content: string): FileCoverage[] {
    try {
      const data = JSON.parse(content) as IstanbulCoverage;
      const results: FileCoverage[] = [];

      for (const [filePath, coverage] of Object.entries(data)) {
        const fileCoverage = this.istanbulToFileCoverage(filePath, coverage);
        results.push(fileCoverage);
      }

      return results;
    } catch (error) {
      this.logError('Failed to parse Istanbul coverage', error);
      return [];
    }
  }

  /**
   * Convert Istanbul coverage to FileCoverage
   */
  private istanbulToFileCoverage(
    filePath: string,
    coverage: IstanbulCoverage[string]
  ): FileCoverage {
    // Calculate line coverage
    const statements = Object.values(coverage.s);
    const coveredStatements = statements.filter((s) => s > 0).length;
    const lineCoverage = statements.length > 0
      ? (coveredStatements / statements.length) * 100
      : 100;

    // Calculate function coverage
    const functions = Object.values(coverage.f);
    const coveredFunctions = functions.filter((f) => f > 0).length;
    const functionCoverage = functions.length > 0
      ? (coveredFunctions / functions.length) * 100
      : 100;

    // Calculate branch coverage
    const branches = Object.values(coverage.b).flat();
    const coveredBranches = branches.filter((b) => b > 0).length;
    const branchCoverage = branches.length > 0
      ? (coveredBranches / branches.length) * 100
      : 100;

    // Find uncovered lines from statement map
    const uncoveredLines: number[] = [];
    for (const [key, count] of Object.entries(coverage.s)) {
      if (count === 0) {
        const stmt = coverage.statementMap[key];
        if (stmt) {
          uncoveredLines.push(stmt.start.line);
        }
      }
    }

    // Find uncovered functions
    const uncoveredFunctions: Array<{ name: string; line: number }> = [];
    for (const [key, count] of Object.entries(coverage.f)) {
      if (count === 0) {
        const fn = coverage.fnMap[key];
        if (fn) {
          uncoveredFunctions.push({
            name: fn.name,
            line: fn.decl.start.line,
          });
        }
      }
    }

    // Find uncovered branches
    const uncoveredBranches: Array<{ line: number; branch: number }> = [];
    for (const [key, counts] of Object.entries(coverage.b)) {
      counts.forEach((count, branchIndex) => {
        if (count === 0) {
          const branch = coverage.branchMap[key];
          if (branch) {
            uncoveredBranches.push({
              line: branch.loc.start.line,
              branch: branchIndex,
            });
          }
        }
      });
    }

    return {
      file: filePath,
      lineCoverage,
      functionCoverage,
      branchCoverage,
      uncoveredLines: [...new Set(uncoveredLines)].sort((a, b) => a - b),
      uncoveredFunctions,
      uncoveredBranches,
    };
  }

  /**
   * Analyze coverage for a single file
   */
  private analyzeFileCoverage(
    fileCoverage: FileCoverage,
    config: Required<CoverageAnalyzerConfig>,
    options: AnalyzerOptions
  ): Issue[] {
    const issues: Issue[] = [];

    // Check line coverage threshold
    if (fileCoverage.lineCoverage < config.lineThreshold) {
      issues.push(
        this.createIssue({
          severity: this.getCoverageSeverity(fileCoverage.lineCoverage, config.lineThreshold),
          message: `Line coverage ${fileCoverage.lineCoverage.toFixed(1)}% is below threshold ${config.lineThreshold}%`,
          description: `This file has ${fileCoverage.uncoveredLines.length} uncovered lines.`,
          location: {
            file: fileCoverage.file,
            line: 1,
            column: 1,
          },
          metadata: {
            lineCoverage: fileCoverage.lineCoverage,
            uncoveredLines: fileCoverage.uncoveredLines.slice(0, 10),
          },
        })
      );
    }

    // Check function coverage threshold
    if (fileCoverage.functionCoverage < config.functionThreshold) {
      issues.push(
        this.createIssue({
          severity: this.getCoverageSeverity(fileCoverage.functionCoverage, config.functionThreshold),
          message: `Function coverage ${fileCoverage.functionCoverage.toFixed(1)}% is below threshold ${config.functionThreshold}%`,
          description: `This file has ${fileCoverage.uncoveredFunctions.length} uncovered functions.`,
          location: {
            file: fileCoverage.file,
            line: 1,
            column: 1,
          },
          metadata: {
            functionCoverage: fileCoverage.functionCoverage,
            uncoveredFunctions: fileCoverage.uncoveredFunctions.slice(0, 10),
          },
        })
      );
    }

    // Check branch coverage threshold
    if (fileCoverage.branchCoverage < config.branchThreshold) {
      issues.push(
        this.createIssue({
          severity: this.getCoverageSeverity(fileCoverage.branchCoverage, config.branchThreshold),
          message: `Branch coverage ${fileCoverage.branchCoverage.toFixed(1)}% is below threshold ${config.branchThreshold}%`,
          description: `This file has ${fileCoverage.uncoveredBranches.length} uncovered branches.`,
          location: {
            file: fileCoverage.file,
            line: 1,
            column: 1,
          },
          metadata: {
            branchCoverage: fileCoverage.branchCoverage,
            uncoveredBranches: fileCoverage.uncoveredBranches.slice(0, 10),
          },
        })
      );
    }

    // Report functions with zero coverage
    if (config.reportZeroCoverageFunctions) {
      for (const func of fileCoverage.uncoveredFunctions) {
        issues.push(
          this.createIssue({
            severity: 'warning',
            message: `Function '${func.name}' has no test coverage`,
            description: 'This function has never been executed during tests.',
            location: {
              file: fileCoverage.file,
              line: func.line,
              column: 1,
            },
            suggestion: 'Add tests for this function',
          })
        );
      }
    }

    return issues;
  }

  /**
   * Get severity based on coverage percentage
   */
  private getCoverageSeverity(coverage: number, threshold: number): Severity {
    if (coverage === 0) {
      return 'error';
    }
    if (coverage < threshold / 2) {
      return 'error';
    }
    if (coverage < threshold) {
      return 'warning';
    }
    return 'info';
  }
}
