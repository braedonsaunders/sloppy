/**
 * Tool Executor for LLM Analyzer
 *
 * Provides tools that the LLM can use to analyze code:
 * - Run ESLint
 * - Run TypeScript compiler
 * - Run tests
 * - Run build scripts
 * - Read files
 * - Search for patterns
 */

import { spawn, SpawnOptions } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { glob } from 'glob';

/**
 * Result of executing a tool
 */
export interface ToolResult {
  success: boolean;
  output: string;
  stderr: string;
  exitCode: number;
  duration: number;
}

/**
 * ESLint result parsed
 */
export interface ESLintIssue {
  filePath: string;
  line: number;
  column: number;
  message: string;
  ruleId: string;
  severity: 'error' | 'warning';
}

/**
 * TypeScript error parsed
 */
export interface TypeScriptError {
  filePath: string;
  line: number;
  column: number;
  message: string;
  code: number;
}

/**
 * Test result parsed
 */
export interface TestResult {
  passed: number;
  failed: number;
  skipped: number;
  failures: Array<{
    testName: string;
    error: string;
    file?: string;
  }>;
}

/**
 * Tool definitions for the LLM
 */
export const TOOL_DEFINITIONS = [
  {
    name: 'run_eslint',
    description: 'Run ESLint on the codebase or specific files. Returns lint errors and warnings.',
    parameters: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific files to lint (optional, defaults to all)',
        },
        fix: {
          type: 'boolean',
          description: 'Whether to auto-fix issues (default: false)',
        },
      },
    },
  },
  {
    name: 'run_typecheck',
    description: 'Run TypeScript compiler to check for type errors. Returns type errors found.',
    parameters: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific files to check (optional, defaults to all)',
        },
      },
    },
  },
  {
    name: 'run_tests',
    description: 'Run the test suite. Returns test results including any failures.',
    parameters: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Test file pattern to run (optional)',
        },
        testName: {
          type: 'string',
          description: 'Specific test name to run (optional)',
        },
      },
    },
  },
  {
    name: 'run_build',
    description: 'Run the build process. Returns build errors if any.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'read_file',
    description: 'Read the contents of a file. Use this to examine code in detail.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the file to read (relative to project root)',
        },
        startLine: {
          type: 'number',
          description: 'Start line (1-indexed, optional)',
        },
        endLine: {
          type: 'number',
          description: 'End line (1-indexed, optional)',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'search_code',
    description: 'Search for a pattern in the codebase. Returns matching files and lines.',
    parameters: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Search pattern (regex supported)',
        },
        filePattern: {
          type: 'string',
          description: 'Glob pattern for files to search (optional)',
        },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'list_files',
    description: 'List files in a directory or matching a pattern.',
    parameters: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Glob pattern (default: **/*.{ts,tsx,js,jsx})',
        },
        directory: {
          type: 'string',
          description: 'Directory to search in (optional)',
        },
      },
    },
  },
  {
    name: 'get_file_info',
    description: 'Get information about a file including imports, exports, and structure.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the file',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'run_custom_command',
    description: 'Run a custom shell command (restricted to safe commands).',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Command to run (must be in allowed list)',
        },
        args: {
          type: 'array',
          items: { type: 'string' },
          description: 'Command arguments',
        },
      },
      required: ['command'],
    },
  },
  {
    name: 'create_issue',
    description: 'Create an issue to report a problem found in the code.',
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['bug', 'security', 'lint', 'type', 'stub', 'duplicate', 'dead-code', 'coverage'],
          description: 'Type of issue',
        },
        severity: {
          type: 'string',
          enum: ['error', 'warning', 'info', 'hint'],
          description: 'Issue severity',
        },
        title: {
          type: 'string',
          description: 'Brief title',
        },
        description: {
          type: 'string',
          description: 'Detailed description',
        },
        file: {
          type: 'string',
          description: 'File path',
        },
        lineStart: {
          type: 'number',
          description: 'Starting line number',
        },
        lineEnd: {
          type: 'number',
          description: 'Ending line number',
        },
        suggestedFix: {
          type: 'string',
          description: 'Suggested fix',
        },
      },
      required: ['type', 'severity', 'title', 'description', 'file', 'lineStart', 'lineEnd'],
    },
  },
];

/**
 * Allowed commands for custom command execution
 */
const ALLOWED_COMMANDS = new Set([
  'npm',
  'npx',
  'pnpm',
  'yarn',
  'node',
  'cat',
  'head',
  'tail',
  'grep',
  'find',
  'wc',
  'ls',
]);

/**
 * Tool Executor that runs development tools
 */
export class ToolExecutor {
  private readonly rootDir: string;
  private readonly timeout: number;

  constructor(rootDir: string, timeout: number = 60000) {
    this.rootDir = rootDir;
    this.timeout = timeout;
  }

  /**
   * Execute a tool call from the LLM
   */
  async executeTool(
    toolName: string,
    params: Record<string, unknown>
  ): Promise<{ result: unknown; output: string }> {
    switch (toolName) {
      case 'run_eslint':
        return this.runESLint(params.files as string[] | undefined, params.fix as boolean);
      case 'run_typecheck':
        return this.runTypeCheck(params.files as string[] | undefined);
      case 'run_tests':
        return this.runTests(params.pattern as string | undefined, params.testName as string | undefined);
      case 'run_build':
        return this.runBuild();
      case 'read_file':
        return this.readFile(params.path as string, params.startLine as number | undefined, params.endLine as number | undefined);
      case 'search_code':
        return this.searchCode(params.pattern as string, params.filePattern as string | undefined);
      case 'list_files':
        return this.listFiles(params.pattern as string | undefined, params.directory as string | undefined);
      case 'get_file_info':
        return this.getFileInfo(params.path as string);
      case 'run_custom_command':
        return this.runCustomCommand(params.command as string, params.args as string[] | undefined);
      case 'create_issue':
        // This is handled specially - just return the params
        return { result: params, output: 'Issue created' };
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }

  /**
   * Run ESLint
   */
  async runESLint(
    files?: string[],
    fix?: boolean
  ): Promise<{ result: ESLintIssue[]; output: string }> {
    const args = ['eslint', '--format', 'json'];
    if (fix) args.push('--fix');

    if (files && files.length > 0) {
      args.push(...files);
    } else {
      args.push('.');
    }

    const result = await this.runCommand('npx', args);
    const issues: ESLintIssue[] = [];

    if (result.output) {
      try {
        const eslintOutput = JSON.parse(result.output) as Array<{
          filePath: string;
          messages: Array<{
            line: number;
            column: number;
            message: string;
            ruleId: string;
            severity: number;
          }>;
        }>;

        for (const file of eslintOutput) {
          for (const msg of file.messages) {
            issues.push({
              filePath: path.relative(this.rootDir, file.filePath),
              line: msg.line,
              column: msg.column,
              message: msg.message,
              ruleId: msg.ruleId || 'unknown',
              severity: msg.severity === 2 ? 'error' : 'warning',
            });
          }
        }
      } catch {
        // If JSON parsing fails, try to extract info from text output
      }
    }

    return {
      result: issues,
      output: issues.length > 0
        ? `Found ${issues.length} ESLint issues:\n${issues.map(i => `  ${i.filePath}:${i.line} - ${i.severity}: ${i.message}`).join('\n')}`
        : 'No ESLint issues found',
    };
  }

  /**
   * Run TypeScript type checking
   */
  async runTypeCheck(files?: string[]): Promise<{ result: TypeScriptError[]; output: string }> {
    const args = ['tsc', '--noEmit', '--pretty', 'false'];

    if (files && files.length > 0) {
      args.push(...files);
    }

    const result = await this.runCommand('npx', args);
    const errors: TypeScriptError[] = [];

    // Parse TypeScript error output
    // Format: path(line,col): error TS1234: message
    const errorRegex = /^(.+?)\((\d+),(\d+)\):\s+error\s+TS(\d+):\s+(.+)$/gm;
    let match;

    const output = result.output + result.stderr;
    while ((match = errorRegex.exec(output)) !== null) {
      errors.push({
        filePath: match[1]!,
        line: parseInt(match[2]!, 10),
        column: parseInt(match[3]!, 10),
        code: parseInt(match[4]!, 10),
        message: match[5]!,
      });
    }

    return {
      result: errors,
      output: errors.length > 0
        ? `Found ${errors.length} TypeScript errors:\n${errors.map(e => `  ${e.filePath}:${e.line} - TS${e.code}: ${e.message}`).join('\n')}`
        : 'No TypeScript errors found',
    };
  }

  /**
   * Run tests
   */
  async runTests(
    pattern?: string,
    testName?: string
  ): Promise<{ result: TestResult; output: string }> {
    // Try to detect test runner
    const packageJson = await this.readPackageJson();
    let command = 'npm';
    let args = ['test'];

    if (packageJson?.scripts?.test) {
      if (packageJson.scripts.test.includes('vitest')) {
        command = 'npx';
        args = ['vitest', 'run', '--reporter=json'];
        if (pattern) args.push(pattern);
        if (testName) args.push('-t', testName);
      } else if (packageJson.scripts.test.includes('jest')) {
        command = 'npx';
        args = ['jest', '--json'];
        if (pattern) args.push(pattern);
        if (testName) args.push('-t', testName);
      }
    }

    const result = await this.runCommand(command, args);
    const testResult: TestResult = {
      passed: 0,
      failed: 0,
      skipped: 0,
      failures: [],
    };

    // Try to parse JSON output
    try {
      const jsonMatch = result.output.match(/\{[\s\S]*"numPassedTests"[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as {
          numPassedTests?: number;
          numFailedTests?: number;
          numPendingTests?: number;
          testResults?: Array<{
            assertionResults?: Array<{
              status: string;
              title: string;
              failureMessages?: string[];
            }>;
          }>;
        };
        testResult.passed = parsed.numPassedTests ?? 0;
        testResult.failed = parsed.numFailedTests ?? 0;
        testResult.skipped = parsed.numPendingTests ?? 0;

        // Extract failure details
        if (parsed.testResults) {
          for (const suite of parsed.testResults) {
            for (const test of suite.assertionResults ?? []) {
              if (test.status === 'failed') {
                testResult.failures.push({
                  testName: test.title,
                  error: test.failureMessages?.join('\n') ?? 'Unknown error',
                });
              }
            }
          }
        }
      }
    } catch {
      // Fall back to simple parsing
      const passMatch = result.output.match(/(\d+)\s+(?:passing|passed)/i);
      const failMatch = result.output.match(/(\d+)\s+(?:failing|failed)/i);
      if (passMatch) testResult.passed = parseInt(passMatch[1]!, 10);
      if (failMatch) testResult.failed = parseInt(failMatch[1]!, 10);
    }

    return {
      result: testResult,
      output: `Tests: ${testResult.passed} passed, ${testResult.failed} failed, ${testResult.skipped} skipped${
        testResult.failures.length > 0
          ? '\n\nFailures:\n' + testResult.failures.map(f => `  - ${f.testName}: ${f.error.substring(0, 200)}`).join('\n')
          : ''
      }`,
    };
  }

  /**
   * Run build
   */
  async runBuild(): Promise<{ result: { success: boolean; errors: string[] }; output: string }> {
    const result = await this.runCommand('npm', ['run', 'build']);
    const errors: string[] = [];

    if (result.exitCode !== 0) {
      // Extract error messages
      const errorLines = (result.stderr + result.output).split('\n').filter(
        line => line.includes('error') || line.includes('Error') || line.includes('ERROR')
      );
      errors.push(...errorLines.slice(0, 10)); // Limit to 10 errors
    }

    return {
      result: {
        success: result.exitCode === 0,
        errors,
      },
      output: result.exitCode === 0
        ? 'Build succeeded'
        : `Build failed with errors:\n${errors.join('\n')}`,
    };
  }

  /**
   * Read a file
   */
  async readFile(
    filePath: string,
    startLine?: number,
    endLine?: number
  ): Promise<{ result: { content: string; lines: number }; output: string }> {
    const fullPath = path.isAbsolute(filePath)
      ? filePath
      : path.join(this.rootDir, filePath);

    try {
      const content = await fs.promises.readFile(fullPath, 'utf-8');
      const lines = content.split('\n');

      if (startLine !== undefined || endLine !== undefined) {
        const start = (startLine ?? 1) - 1;
        const end = endLine ?? lines.length;
        const selectedLines = lines.slice(start, end);
        const numberedContent = selectedLines
          .map((line, i) => `${start + i + 1} | ${line}`)
          .join('\n');

        return {
          result: { content: selectedLines.join('\n'), lines: selectedLines.length },
          output: `File: ${filePath} (lines ${start + 1}-${end})\n\n${numberedContent}`,
        };
      }

      const numberedContent = lines
        .map((line, i) => `${i + 1} | ${line}`)
        .join('\n');

      return {
        result: { content, lines: lines.length },
        output: `File: ${filePath} (${lines.length} lines)\n\n${numberedContent}`,
      };
    } catch (error) {
      throw new Error(`Failed to read file: ${filePath}`);
    }
  }

  /**
   * Search code for a pattern
   */
  async searchCode(
    pattern: string,
    filePattern?: string
  ): Promise<{ result: Array<{ file: string; line: number; content: string }>; output: string }> {
    const matches: Array<{ file: string; line: number; content: string }> = [];
    const searchPattern = filePattern ?? '**/*.{ts,tsx,js,jsx}';
    const files = await glob(searchPattern, {
      cwd: this.rootDir,
      absolute: true,
      ignore: ['**/node_modules/**', '**/dist/**', '**/build/**'],
    });

    const regex = new RegExp(pattern, 'gi');

    for (const file of files.slice(0, 100)) { // Limit files searched
      try {
        const content = await fs.promises.readFile(file, 'utf-8');
        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i]!)) {
            matches.push({
              file: path.relative(this.rootDir, file),
              line: i + 1,
              content: lines[i]!.trim(),
            });
          }
          regex.lastIndex = 0; // Reset regex
        }
      } catch {
        // Skip files that can't be read
      }
    }

    return {
      result: matches.slice(0, 50), // Limit results
      output: matches.length > 0
        ? `Found ${matches.length} matches:\n${matches.slice(0, 20).map(m => `  ${m.file}:${m.line}: ${m.content.substring(0, 80)}`).join('\n')}`
        : 'No matches found',
    };
  }

  /**
   * List files
   */
  async listFiles(
    pattern?: string,
    directory?: string
  ): Promise<{ result: string[]; output: string }> {
    const searchPattern = pattern ?? '**/*.{ts,tsx,js,jsx}';
    const cwd = directory ? path.join(this.rootDir, directory) : this.rootDir;

    const files = await glob(searchPattern, {
      cwd,
      ignore: ['**/node_modules/**', '**/dist/**', '**/build/**'],
    });

    const sortedFiles = files.sort();
    return {
      result: sortedFiles,
      output: `Found ${files.length} files:\n${sortedFiles.slice(0, 50).join('\n')}${files.length > 50 ? '\n...(truncated)' : ''}`,
    };
  }

  /**
   * Get file info including imports/exports
   */
  async getFileInfo(
    filePath: string
  ): Promise<{ result: { imports: string[]; exports: string[]; functions: string[]; classes: string[] }; output: string }> {
    const { result: file } = await this.readFile(filePath);
    const content = file.content;

    // Extract imports
    const importRegex = /(?:import|from)\s+['"]([^'"]+)['"]/g;
    const imports: string[] = [];
    let match;
    while ((match = importRegex.exec(content)) !== null) {
      imports.push(match[1]!);
    }

    // Extract exports
    const exportRegex = /export\s+(?:default\s+)?(?:const|let|var|function|class|interface|type|enum)\s+(\w+)/g;
    const exports: string[] = [];
    while ((match = exportRegex.exec(content)) !== null) {
      exports.push(match[1]!);
    }

    // Extract function names
    const funcRegex = /(?:function|const|let|var)\s+(\w+)\s*(?:=\s*(?:async\s*)?\(|[\(<])/g;
    const functions: string[] = [];
    while ((match = funcRegex.exec(content)) !== null) {
      functions.push(match[1]!);
    }

    // Extract class names
    const classRegex = /class\s+(\w+)/g;
    const classes: string[] = [];
    while ((match = classRegex.exec(content)) !== null) {
      classes.push(match[1]!);
    }

    const info = { imports, exports, functions, classes };

    return {
      result: info,
      output: `File: ${filePath}\n\nImports (${imports.length}):\n${imports.map(i => `  - ${i}`).join('\n')}\n\nExports (${exports.length}):\n${exports.map(e => `  - ${e}`).join('\n')}\n\nFunctions (${functions.length}):\n${functions.map(f => `  - ${f}`).join('\n')}\n\nClasses (${classes.length}):\n${classes.map(c => `  - ${c}`).join('\n')}`,
    };
  }

  /**
   * Run a custom command (restricted)
   */
  async runCustomCommand(
    command: string,
    args?: string[]
  ): Promise<{ result: ToolResult; output: string }> {
    if (!ALLOWED_COMMANDS.has(command)) {
      throw new Error(`Command '${command}' is not allowed. Allowed commands: ${Array.from(ALLOWED_COMMANDS).join(', ')}`);
    }

    const result = await this.runCommand(command, args ?? []);
    return {
      result,
      output: result.output || result.stderr || 'Command completed',
    };
  }

  /**
   * Run a shell command
   */
  private async runCommand(command: string, args: string[]): Promise<ToolResult> {
    const startTime = Date.now();

    return new Promise((resolve) => {
      const options: SpawnOptions = {
        cwd: this.rootDir,
        shell: true,
        timeout: this.timeout,
      };

      const proc = spawn(command, args, options);

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        resolve({
          success: code === 0,
          output: stdout,
          stderr,
          exitCode: code ?? 1,
          duration: Date.now() - startTime,
        });
      });

      proc.on('error', (error) => {
        resolve({
          success: false,
          output: '',
          stderr: error.message,
          exitCode: 1,
          duration: Date.now() - startTime,
        });
      });
    });
  }

  /**
   * Read package.json
   */
  private async readPackageJson(): Promise<{
    scripts?: Record<string, string>;
  } | null> {
    try {
      const content = await fs.promises.readFile(
        path.join(this.rootDir, 'package.json'),
        'utf-8'
      );
      return JSON.parse(content);
    } catch {
      return null;
    }
  }
}
