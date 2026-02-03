/**
 * Verification Service for Sloppy
 * Runs tests, linting, and build commands with output parsing
 */

import { spawn, ChildProcess } from 'child_process';
import {
  TestResult,
  LintResult,
  BuildResult,
  VerificationResult,
  VerificationStatus,
  SessionConfig,
  Logger,
  TestError,
  LintError,
  BuildError,
} from './types';

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_TIMEOUT_MS = 300000; // 5 minutes

// ============================================================================
// Types
// ============================================================================

export interface VerificationOptions {
  cwd: string;
  timeout?: number;
  env?: Record<string, string>;
}

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  duration: number;
}

// ============================================================================
// Verification Service Class
// ============================================================================

export class VerificationService {
  private logger: Logger;
  private runningProcesses: Map<string, ChildProcess> = new Map();

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Run all verification steps based on session config
   */
  async runAll(
    config: SessionConfig,
    options: VerificationOptions
  ): Promise<VerificationResult> {
    const startTime = Date.now();
    const results: VerificationResult = {
      overall: 'pass',
      tests: null,
      lint: null,
      build: null,
      duration: 0,
      timestamp: new Date(),
    };

    this.logger.info('Starting verification suite', {
      cwd: options.cwd,
      hasTests: !!config.testCommand,
      hasLint: !!config.lintCommand,
      hasBuild: !!config.buildCommand,
    });

    try {
      // Run build first (if compilation fails, no point running tests/lint)
      if (config.buildCommand) {
        results.build = await this.runBuild(config.buildCommand, options);
        if (results.build.status === 'fail' || results.build.status === 'error') {
          results.overall = 'fail';
          results.duration = Date.now() - startTime;
          return results;
        }
      }

      // Run lint and tests in parallel if both exist
      const parallelTasks: Promise<void>[] = [];

      if (config.lintCommand) {
        parallelTasks.push(
          this.runLint(config.lintCommand, options).then((r) => {
            results.lint = r;
          })
        );
      }

      if (config.testCommand) {
        parallelTasks.push(
          this.runTests(config.testCommand, options).then((r) => {
            results.tests = r;
          })
        );
      }

      await Promise.all(parallelTasks);

      // Determine overall status
      results.overall = this.determineOverallStatus(results);
      results.duration = Date.now() - startTime;

      this.logger.info('Verification suite completed', {
        overall: results.overall,
        duration: results.duration,
        testStatus: results.tests?.status,
        lintStatus: results.lint?.status,
        buildStatus: results.build?.status,
      });

      return results;
    } catch (error) {
      this.logger.error('Verification suite failed', {
        error: error instanceof Error ? error.message : String(error),
      });

      results.overall = 'error';
      results.duration = Date.now() - startTime;
      return results;
    }
  }

  /**
   * Run test command and parse output
   */
  async runTests(
    command: string,
    options: VerificationOptions
  ): Promise<TestResult> {
    const startTime = Date.now();

    this.logger.info('Running tests', { command, cwd: options.cwd });

    const result = await this.executeCommand(command, options, 'test');

    const testResult: TestResult = {
      status: this.determineStatus(result),
      passed: 0,
      failed: 0,
      skipped: 0,
      total: 0,
      duration: result.duration,
      output: this.combineOutput(result),
      errors: [],
    };

    // Parse test output
    this.parseTestOutput(testResult, result);

    this.logger.info('Tests completed', {
      status: testResult.status,
      passed: testResult.passed,
      failed: testResult.failed,
      duration: testResult.duration,
    });

    return testResult;
  }

  /**
   * Run lint command and parse output
   */
  async runLint(
    command: string,
    options: VerificationOptions
  ): Promise<LintResult> {
    this.logger.info('Running lint', { command, cwd: options.cwd });

    const result = await this.executeCommand(command, options, 'lint');

    const lintResult: LintResult = {
      status: this.determineStatus(result),
      errorCount: 0,
      warningCount: 0,
      fixableErrorCount: 0,
      fixableWarningCount: 0,
      duration: result.duration,
      output: this.combineOutput(result),
      errors: [],
    };

    // Parse lint output
    this.parseLintOutput(lintResult, result);

    this.logger.info('Lint completed', {
      status: lintResult.status,
      errors: lintResult.errorCount,
      warnings: lintResult.warningCount,
      duration: lintResult.duration,
    });

    return lintResult;
  }

  /**
   * Run build command and parse output
   */
  async runBuild(
    command: string,
    options: VerificationOptions
  ): Promise<BuildResult> {
    this.logger.info('Running build', { command, cwd: options.cwd });

    const result = await this.executeCommand(command, options, 'build');

    const buildResult: BuildResult = {
      status: this.determineStatus(result),
      duration: result.duration,
      output: this.combineOutput(result),
      errors: [],
    };

    // Parse build output
    this.parseBuildOutput(buildResult, result);

    this.logger.info('Build completed', {
      status: buildResult.status,
      errorCount: buildResult.errors.length,
      duration: buildResult.duration,
    });

    return buildResult;
  }

  /**
   * Cancel all running verification processes
   */
  cancelAll(): void {
    this.logger.info('Cancelling all verification processes', {
      count: this.runningProcesses.size,
    });

    for (const [id, process] of this.runningProcesses.entries()) {
      try {
        process.kill('SIGTERM');
        // Give it a moment, then force kill
        setTimeout(() => {
          if (!process.killed) {
            process.kill('SIGKILL');
          }
        }, 5000);
      } catch (error) {
        this.logger.warn('Failed to kill process', {
          id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.runningProcesses.clear();
  }

  /**
   * Cancel a specific verification process
   */
  cancel(id: string): boolean {
    const process = this.runningProcesses.get(id);
    if (process) {
      try {
        process.kill('SIGTERM');
        this.runningProcesses.delete(id);
        return true;
      } catch (error) {
        this.logger.warn('Failed to cancel process', {
          id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return false;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private async executeCommand(
    command: string,
    options: VerificationOptions,
    type: string
  ): Promise<CommandResult> {
    const timeout = options.timeout || DEFAULT_TIMEOUT_MS;
    const startTime = Date.now();
    const processId = `${type}_${Date.now()}`;

    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      // Parse command - handle npm scripts and direct commands
      const [cmd, ...args] = this.parseCommand(command);

      const childProcess = spawn(cmd, args, {
        cwd: options.cwd,
        shell: true,
        env: {
          ...process.env,
          ...options.env,
          // Ensure CI-friendly output
          CI: 'true',
          FORCE_COLOR: '0',
          NO_COLOR: '1',
        },
      });

      this.runningProcesses.set(processId, childProcess);

      // Set up timeout
      const timeoutId = setTimeout(() => {
        timedOut = true;
        childProcess.kill('SIGTERM');
        setTimeout(() => {
          if (!childProcess.killed) {
            childProcess.kill('SIGKILL');
          }
        }, 5000);
      }, timeout);

      childProcess.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      childProcess.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      childProcess.on('error', (error) => {
        clearTimeout(timeoutId);
        this.runningProcesses.delete(processId);

        resolve({
          exitCode: -1,
          stdout,
          stderr: stderr + `\nProcess error: ${error.message}`,
          timedOut: false,
          duration: Date.now() - startTime,
        });
      });

      childProcess.on('close', (exitCode) => {
        clearTimeout(timeoutId);
        this.runningProcesses.delete(processId);

        resolve({
          exitCode: exitCode ?? -1,
          stdout,
          stderr,
          timedOut,
          duration: Date.now() - startTime,
        });
      });
    });
  }

  private parseCommand(command: string): string[] {
    // Simple command parsing - split by spaces but respect quotes
    const parts: string[] = [];
    let current = '';
    let inQuotes = false;
    let quoteChar = '';

    for (const char of command) {
      if ((char === '"' || char === "'") && !inQuotes) {
        inQuotes = true;
        quoteChar = char;
      } else if (char === quoteChar && inQuotes) {
        inQuotes = false;
        quoteChar = '';
      } else if (char === ' ' && !inQuotes) {
        if (current) {
          parts.push(current);
          current = '';
        }
      } else {
        current += char;
      }
    }

    if (current) {
      parts.push(current);
    }

    return parts;
  }

  private determineStatus(result: CommandResult): VerificationStatus {
    if (result.timedOut) {
      return 'timeout';
    }
    if (result.exitCode === 0) {
      return 'pass';
    }
    if (result.exitCode === -1) {
      return 'error';
    }
    return 'fail';
  }

  private combineOutput(result: CommandResult): string {
    let output = '';
    if (result.stdout) {
      output += result.stdout;
    }
    if (result.stderr) {
      output += (output ? '\n' : '') + result.stderr;
    }
    if (result.timedOut) {
      output += '\n[Process timed out]';
    }
    return output;
  }

  private determineOverallStatus(results: VerificationResult): VerificationStatus {
    const statuses: VerificationStatus[] = [];

    if (results.build) statuses.push(results.build.status);
    if (results.tests) statuses.push(results.tests.status);
    if (results.lint) statuses.push(results.lint.status);

    if (statuses.length === 0) {
      return 'skipped';
    }

    if (statuses.includes('error')) return 'error';
    if (statuses.includes('timeout')) return 'timeout';
    if (statuses.includes('fail')) return 'fail';
    if (statuses.every((s) => s === 'pass' || s === 'skipped')) return 'pass';

    return 'fail';
  }

  private parseTestOutput(result: TestResult, cmdResult: CommandResult): void {
    const output = this.combineOutput(cmdResult);

    // Try to parse Jest output
    const jestMatch = output.match(
      /Tests:\s+(\d+)\s+failed,?\s*(\d+)\s+passed,?\s*(\d+)\s+total/i
    );
    if (jestMatch) {
      result.failed = parseInt(jestMatch[1], 10);
      result.passed = parseInt(jestMatch[2], 10);
      result.total = parseInt(jestMatch[3], 10);
    }

    // Try to parse Jest with skipped
    const jestWithSkipped = output.match(
      /Tests:\s+(\d+)\s+failed,?\s*(\d+)\s+skipped,?\s*(\d+)\s+passed,?\s*(\d+)\s+total/i
    );
    if (jestWithSkipped) {
      result.failed = parseInt(jestWithSkipped[1], 10);
      result.skipped = parseInt(jestWithSkipped[2], 10);
      result.passed = parseInt(jestWithSkipped[3], 10);
      result.total = parseInt(jestWithSkipped[4], 10);
    }

    // Try simple pass/total format
    const simpleMatch = output.match(/(\d+)\s+passing/i);
    if (simpleMatch && result.total === 0) {
      result.passed = parseInt(simpleMatch[1], 10);
      result.total = result.passed;
    }

    const failingMatch = output.match(/(\d+)\s+failing/i);
    if (failingMatch) {
      result.failed = parseInt(failingMatch[1], 10);
      result.total = result.passed + result.failed;
    }

    // Parse individual test failures
    result.errors = this.parseTestErrors(output);
  }

  private parseTestErrors(output: string): TestError[] {
    const errors: TestError[] = [];

    // Jest failure pattern
    const jestFailures = output.matchAll(
      /\u25CF\s+(.+?)\n\n\s+(.+?)(?:\n\n|\s+at\s)/g
    );
    for (const match of jestFailures) {
      errors.push({
        testName: match[1].trim(),
        message: match[2].trim(),
      });
    }

    // Mocha failure pattern
    const mochaFailures = output.matchAll(
      /\d+\)\s+(.+?):\n\s+(.+?)(?:\n\s+at\s)/g
    );
    for (const match of mochaFailures) {
      errors.push({
        testName: match[1].trim(),
        message: match[2].trim(),
      });
    }

    // Generic assertion error pattern
    const assertionErrors = output.matchAll(
      /AssertionError[:\s]+(.+?)(?:\n|$)/g
    );
    for (const match of assertionErrors) {
      if (!errors.some((e) => e.message.includes(match[1]))) {
        errors.push({
          testName: 'Unknown test',
          message: match[1].trim(),
        });
      }
    }

    return errors;
  }

  private parseLintOutput(result: LintResult, cmdResult: CommandResult): void {
    const output = this.combineOutput(cmdResult);

    // ESLint summary pattern
    const eslintSummary = output.match(
      /(\d+)\s+problems?\s+\((\d+)\s+errors?,?\s*(\d+)\s+warnings?\)/i
    );
    if (eslintSummary) {
      result.errorCount = parseInt(eslintSummary[2], 10);
      result.warningCount = parseInt(eslintSummary[3], 10);
    }

    // ESLint fixable pattern
    const fixable = output.match(
      /(\d+)\s+errors?\s+and\s+(\d+)\s+warnings?\s+potentially\s+fixable/i
    );
    if (fixable) {
      result.fixableErrorCount = parseInt(fixable[1], 10);
      result.fixableWarningCount = parseInt(fixable[2], 10);
    }

    // Parse individual lint errors
    result.errors = this.parseLintErrors(output);

    // Update counts from parsed errors if summary wasn't found
    if (result.errorCount === 0 && result.warningCount === 0 && result.errors.length > 0) {
      result.errorCount = result.errors.filter((e) => e.severity === 'error').length;
      result.warningCount = result.errors.filter((e) => e.severity === 'warning').length;
    }
  }

  private parseLintErrors(output: string): LintError[] {
    const errors: LintError[] = [];

    // ESLint format: /path/file.ts
    //   line:col  error/warning  message  rule-name
    const eslintPattern = /^\s*(\d+):(\d+)\s+(error|warning)\s+(.+?)\s+(\S+)\s*$/gm;
    let currentFile = '';

    const lines = output.split('\n');
    for (const line of lines) {
      // Check for file path
      const fileMatch = line.match(/^([\/\w\-\.]+\.(ts|js|tsx|jsx|vue|svelte))$/);
      if (fileMatch) {
        currentFile = fileMatch[1];
        continue;
      }

      // Check for error line
      const errorMatch = line.match(
        /^\s*(\d+):(\d+)\s+(error|warning)\s+(.+?)\s{2,}(\S+)\s*$/
      );
      if (errorMatch && currentFile) {
        errors.push({
          filePath: currentFile,
          line: parseInt(errorMatch[1], 10),
          column: parseInt(errorMatch[2], 10),
          severity: errorMatch[3] as 'error' | 'warning',
          message: errorMatch[4].trim(),
          rule: errorMatch[5],
        });
      }
    }

    return errors;
  }

  private parseBuildOutput(result: BuildResult, cmdResult: CommandResult): void {
    const output = this.combineOutput(cmdResult);

    // TypeScript error pattern
    const tsErrors = output.matchAll(
      /(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.+)/g
    );
    for (const match of tsErrors) {
      result.errors.push({
        filePath: match[1],
        line: parseInt(match[2], 10),
        column: parseInt(match[3], 10),
        code: match[4],
        message: match[5],
      });
    }

    // Webpack/Vite/esbuild error pattern
    const bundlerErrors = output.matchAll(
      /ERROR\s+in\s+(.+?)\n\s*(.+?)(?:\n|$)/g
    );
    for (const match of bundlerErrors) {
      result.errors.push({
        filePath: match[1],
        message: match[2],
      });
    }

    // Generic error pattern
    const genericErrors = output.matchAll(
      /^error(?:\[.+?\])?:\s+(.+)$/gim
    );
    for (const match of genericErrors) {
      if (!result.errors.some((e) => e.message.includes(match[1]))) {
        result.errors.push({
          message: match[1],
        });
      }
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createVerificationService(logger: Logger): VerificationService {
  return new VerificationService(logger);
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Format verification result as a human-readable string
 */
export function formatVerificationResult(result: VerificationResult): string {
  const lines: string[] = [];
  lines.push(`Verification ${result.overall.toUpperCase()} (${result.duration}ms)`);
  lines.push('');

  if (result.build) {
    lines.push(`Build: ${result.build.status}`);
    if (result.build.errors.length > 0) {
      lines.push(`  Errors: ${result.build.errors.length}`);
      for (const error of result.build.errors.slice(0, 5)) {
        lines.push(`    - ${error.filePath || 'unknown'}: ${error.message}`);
      }
    }
  }

  if (result.lint) {
    lines.push(`Lint: ${result.lint.status}`);
    lines.push(`  Errors: ${result.lint.errorCount}, Warnings: ${result.lint.warningCount}`);
    if (result.lint.errors.length > 0) {
      for (const error of result.lint.errors.slice(0, 5)) {
        lines.push(`    - ${error.filePath}:${error.line} [${error.rule}] ${error.message}`);
      }
    }
  }

  if (result.tests) {
    lines.push(`Tests: ${result.tests.status}`);
    lines.push(
      `  Passed: ${result.tests.passed}, Failed: ${result.tests.failed}, Skipped: ${result.tests.skipped}`
    );
    if (result.tests.errors.length > 0) {
      for (const error of result.tests.errors.slice(0, 5)) {
        lines.push(`    - ${error.testName}: ${error.message}`);
      }
    }
  }

  return lines.join('\n');
}

/**
 * Extract error summary for AI feedback
 */
export function extractVerificationErrors(result: VerificationResult): string {
  const errors: string[] = [];

  if (result.build && result.build.status !== 'pass') {
    errors.push('BUILD ERRORS:');
    for (const error of result.build.errors) {
      if (error.filePath && error.line) {
        errors.push(`  ${error.filePath}:${error.line}:${error.column || 0} - ${error.message}`);
      } else {
        errors.push(`  ${error.message}`);
      }
    }
  }

  if (result.lint && result.lint.status !== 'pass') {
    errors.push('LINT ERRORS:');
    for (const error of result.lint.errors.filter((e) => e.severity === 'error')) {
      errors.push(`  ${error.filePath}:${error.line}:${error.column} - [${error.rule}] ${error.message}`);
    }
  }

  if (result.tests && result.tests.status !== 'pass') {
    errors.push('TEST FAILURES:');
    for (const error of result.tests.errors) {
      errors.push(`  ${error.testName}: ${error.message}`);
    }
  }

  return errors.join('\n');
}
