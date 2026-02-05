/**
 * Tool Executor for LLM Analyzer
 *
 * Provides tools that the LLM can use to analyze code:
 * - Run ESLint
 * - Run TypeScript compiler
 * - Run tests
 * - Run build scripts
 * - Read files
 * - Search for patterns (grep)
 * - Find files
 * - Execute shell commands
 * - Persist learnings (Ralph pattern) - via SQLite or file
 */

import { spawn, SpawnOptions } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { glob } from 'glob';
import type { Issue, AnalyzerOptions } from '../base.js';

/**
 * Learning entry for persistence
 */
export interface LearningEntry {
  id?: string;
  category: string;
  pattern: string;
  description: string;
  file_patterns?: string[];
  confidence?: number;
}

/**
 * Learnings store interface for pluggable persistence
 * Can be backed by SQLite database or file system
 */
export interface LearningsStore {
  /** Write a learning entry */
  write(learning: LearningEntry): Promise<void>;
  /** Read all learnings, optionally filtered by category */
  read(category?: string): Promise<LearningEntry[]>;
  /** Search learnings by pattern */
  search(query: string): Promise<LearningEntry[]>;
  /** Mark a learning as applied */
  markApplied?(learningId: string): Promise<void>;
}

/**
 * File-based learnings store (default fallback)
 */
export class FileLearningsStore implements LearningsStore {
  private readonly filePath: string;

  constructor(rootDir: string, file?: string) {
    this.filePath = file ?? path.join(rootDir, '.sloppy', 'learnings.json');
  }

  async write(learning: LearningEntry): Promise<void> {
    await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });

    let learnings: LearningEntry[] = [];
    try {
      const content = await fs.promises.readFile(this.filePath, 'utf-8');
      learnings = JSON.parse(content) as LearningEntry[];
    } catch {
      // File doesn't exist yet
    }

    learning.id = `file-${String(Date.now())}-${Math.random().toString(36).slice(2)}`;
    learnings.push(learning);

    await fs.promises.writeFile(this.filePath, JSON.stringify(learnings, null, 2), 'utf-8');
  }

  async read(category?: string): Promise<LearningEntry[]> {
    try {
      const content = await fs.promises.readFile(this.filePath, 'utf-8');
      const learnings = JSON.parse(content) as LearningEntry[];
      if (category !== undefined && category !== '') {
        return learnings.filter(l => l.category === category);
      }
      return learnings;
    } catch {
      return [];
    }
  }

  async search(query: string): Promise<LearningEntry[]> {
    const learnings = await this.read();
    const lowerQuery = query.toLowerCase();
    return learnings.filter(l =>
      l.pattern.toLowerCase().includes(lowerQuery) ||
      l.description.toLowerCase().includes(lowerQuery)
    );
  }
}

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
  failures: {
    testName: string;
    error: string;
    file?: string;
  }[];
}

/**
 * Grep match result
 */
export interface GrepMatch {
  file: string;
  line: number;
  column: number;
  content: string;
  beforeContext?: string[];
  afterContext?: string[];
}

/**
 * Tool definitions for the LLM
 */
export const TOOL_DEFINITIONS = [
  {
    name: 'run_lint',
    description: 'Auto-detect and run the appropriate linter for this codebase. Supports: ESLint (JS/TS), ruff/pylint/flake8 (Python), golangci-lint (Go), cargo clippy (Rust), rubocop (Ruby), phpstan (PHP), cppcheck (C/C++), and more. Returns lint errors and warnings.',
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
    name: 'run_eslint',
    description: 'Run ESLint on JavaScript/TypeScript files. Only works for JS/TS projects. Use run_lint for auto-detection.',
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
    description: 'Run type checking for the project. Auto-detects: TypeScript (tsc), Python (mypy/pyright), Rust (cargo check), Go (go vet). Returns type errors found.',
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
    description: 'Run the test suite. Auto-detects: Jest/Vitest (JS/TS), pytest (Python), go test (Go), cargo test (Rust), rspec (Ruby), phpunit (PHP). Returns test results including any failures.',
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
    description: 'Run the build process. Auto-detects: npm/pnpm build (JS/TS), cargo build (Rust), go build (Go), make (C/C++), gradle/mvn (Java). Returns build errors if any.',
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
    name: 'grep',
    description: 'Search for a pattern in files using grep. Supports regex patterns. Returns matching lines with context.',
    parameters: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Search pattern (supports regex)',
        },
        path: {
          type: 'string',
          description: 'File or directory path to search (default: current directory)',
        },
        include: {
          type: 'string',
          description: 'File pattern to include (e.g., "*.ts", "*.{js,jsx}")',
        },
        exclude: {
          type: 'string',
          description: 'File pattern to exclude (e.g., "node_modules")',
        },
        ignoreCase: {
          type: 'boolean',
          description: 'Case insensitive search (default: false)',
        },
        contextLines: {
          type: 'number',
          description: 'Number of context lines before/after match (default: 0)',
        },
        maxResults: {
          type: 'number',
          description: 'Maximum number of results to return (default: 100)',
        },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'find_files',
    description: 'Find files matching a pattern. Similar to Unix find command.',
    parameters: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Glob pattern to match (e.g., "**/*.ts", "src/**/*.{js,jsx}")',
        },
        path: {
          type: 'string',
          description: 'Directory to search in (default: current directory)',
        },
        type: {
          type: 'string',
          enum: ['file', 'directory', 'all'],
          description: 'Type of entries to find (default: file)',
        },
        maxDepth: {
          type: 'number',
          description: 'Maximum directory depth to search',
        },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'list_files',
    description: 'List files in a directory.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory path (default: current directory)',
        },
        recursive: {
          type: 'boolean',
          description: 'List recursively (default: false)',
        },
        showHidden: {
          type: 'boolean',
          description: 'Show hidden files (default: false)',
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
    name: 'bash',
    description: 'Execute a shell command. Restricted to safe commands for code analysis.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Shell command to execute',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in milliseconds (default: 30000)',
        },
      },
      required: ['command'],
    },
  },
  {
    name: 'git',
    description: 'Execute git commands for repository analysis.',
    parameters: {
      type: 'object',
      properties: {
        args: {
          type: 'array',
          items: { type: 'string' },
          description: 'Git command arguments (e.g., ["log", "--oneline", "-10"])',
        },
      },
      required: ['args'],
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
  {
    name: 'write_learnings',
    description: 'Write learnings from analysis to persist across iterations. Follows Ralph pattern. Stored in SQLite database when available.',
    parameters: {
      type: 'object',
      properties: {
        learnings: {
          type: 'string',
          description: 'Learnings and patterns discovered during analysis',
        },
        category: {
          type: 'string',
          enum: ['general', 'bug-pattern', 'security', 'performance', 'style', 'testing'],
          description: 'Category of the learning (default: general)',
        },
      },
      required: ['learnings'],
    },
  },
  {
    name: 'read_learnings',
    description: 'Read learnings from previous analysis iterations.',
    parameters: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: ['general', 'bug-pattern', 'security', 'performance', 'style', 'testing'],
          description: 'Filter by category (optional)',
        },
      },
    },
  },
  {
    name: 'search_learnings',
    description: 'Search for relevant learnings by keyword or pattern.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query to find relevant learnings',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'run_stub_analysis',
    description: 'Run the stubs analyzer to detect TODO, FIXME, HACK, and other stub comments in the codebase. Works on all languages.',
    parameters: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific files to analyze (optional, defaults to all discovered files)',
        },
        rootDir: {
          type: 'string',
          description: 'Project root directory (optional, defaults to current project root)',
        },
      },
    },
  },
  {
    name: 'run_duplicate_analysis',
    description: 'Run the duplicate code analyzer to detect copy-pasted or duplicated code blocks. Uses jscpd and supports many languages.',
    parameters: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific files to analyze (optional, defaults to all discovered files)',
        },
        rootDir: {
          type: 'string',
          description: 'Project root directory (optional, defaults to current project root)',
        },
      },
    },
  },
  {
    name: 'run_security_analysis',
    description: 'Run the security analyzer to detect potential vulnerabilities: injection flaws, hardcoded secrets, insecure patterns. Works on all languages via regex patterns.',
    parameters: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific files to analyze (optional, defaults to all discovered files)',
        },
        rootDir: {
          type: 'string',
          description: 'Project root directory (optional, defaults to current project root)',
        },
      },
    },
  },
  {
    name: 'run_dead_code_analysis',
    description: 'Run the dead code analyzer to detect unused exports, unreachable code, and unused variables. JS/TS only (uses TypeScript AST).',
    parameters: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific files to analyze (optional, defaults to all discovered files)',
        },
        rootDir: {
          type: 'string',
          description: 'Project root directory (optional, defaults to current project root)',
        },
      },
    },
  },
  {
    name: 'run_bug_analysis',
    description: 'Run the bug pattern analyzer to detect common logic bugs: off-by-one errors, incorrect comparisons, missing null checks. JS/TS only.',
    parameters: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific files to analyze (optional, defaults to all discovered files)',
        },
        rootDir: {
          type: 'string',
          description: 'Project root directory (optional, defaults to current project root)',
        },
      },
    },
  },
  {
    name: 'run_type_analysis',
    description: 'Run the type analyzer to detect type safety issues: unsafe any usage, missing return types, implicit type coercions. JS/TS only.',
    parameters: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific files to analyze (optional, defaults to all discovered files)',
        },
        rootDir: {
          type: 'string',
          description: 'Project root directory (optional, defaults to current project root)',
        },
      },
    },
  },
  {
    name: 'run_coverage_analysis',
    description: 'Run the coverage analyzer to detect untested code by analyzing existing coverage reports (LCOV format). Works on all languages that produce LCOV output.',
    parameters: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific files to analyze (optional, defaults to all discovered files)',
        },
        rootDir: {
          type: 'string',
          description: 'Project root directory (optional, defaults to current project root)',
        },
      },
    },
  },
];

/**
 * Allowed shell commands for bash tool - supports ALL languages
 */
const ALLOWED_BASH_COMMANDS = new Set([
  // General unix tools
  'cat', 'head', 'tail', 'wc', 'sort', 'uniq', 'cut', 'tr',
  'echo', 'printf', 'date', 'pwd', 'env', 'which', 'type',
  'ls', 'tree', 'file', 'stat', 'du', 'df',
  'grep', 'awk', 'sed', 'xargs', 'tee',
  'git', 'jq', 'diff', 'patch',
  // JavaScript/TypeScript
  'npm', 'npx', 'pnpm', 'yarn', 'node', 'tsc', 'eslint', 'prettier',
  // Python
  'python', 'python3', 'pip', 'pip3', 'pipx',
  'ruff', 'pylint', 'flake8', 'mypy', 'pyright', 'bandit', 'black', 'isort',
  'pytest', 'unittest',
  // Go
  'go', 'golangci-lint', 'gofmt', 'govet',
  // Rust
  'cargo', 'rustc', 'clippy', 'rustfmt',
  // Java/Kotlin
  'java', 'javac', 'gradle', 'gradlew', 'mvn', 'mvnw',
  'ktlint', 'detekt',
  // Ruby
  'ruby', 'bundler', 'bundle', 'rubocop', 'rake',
  // PHP
  'php', 'composer', 'phpstan', 'phpcs', 'psalm',
  // C/C++
  'gcc', 'g++', 'clang', 'clang++', 'make', 'cmake', 'cppcheck',
  // C#/.NET
  'dotnet', 'msbuild',
  // Swift
  'swift', 'swiftlint', 'xcodebuild',
  // Dart/Flutter
  'dart', 'flutter',
  // Elixir
  'mix', 'elixir',
  // Shell linting
  'shellcheck',
]);

/**
 * Blocked patterns in bash commands
 */
const BLOCKED_PATTERNS = [
  /rm\s+(-rf?|--force)/i,
  />\s*\/dev\//,
  /mkfs/,
  /dd\s+if=/,
  /chmod\s+777/,
  /curl.*\|\s*(ba)?sh/,
  /wget.*\|\s*(ba)?sh/,
  /eval\s/,
  /\$\(/,  // command substitution
  /`/,     // backticks
];

/**
 * Tool Executor that runs development tools
 */
export class ToolExecutor {
  private readonly rootDir: string;
  private readonly timeout: number;
  private learningsStore: LearningsStore;

  constructor(rootDir: string, timeout = 60000, learningsStore?: LearningsStore) {
    this.rootDir = rootDir;
    this.timeout = timeout;
    this.learningsStore = learningsStore ?? new FileLearningsStore(rootDir);
  }

  /**
   * Set a custom learnings store (e.g., SQLite-backed)
   */
  setLearningsStore(store: LearningsStore): void {
    this.learningsStore = store;
  }

  /**
   * Execute a tool call from the LLM
   */
  async executeTool(
    toolName: string,
    params: Record<string, unknown>
  ): Promise<{ result: unknown; output: string }> {
    switch (toolName) {
      case 'run_lint':
        return this.runLint(params.files as string[] | undefined, params.fix as boolean);
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
      case 'grep':
        return this.grep(params as {
          pattern: string;
          path?: string;
          include?: string;
          exclude?: string;
          ignoreCase?: boolean;
          contextLines?: number;
          maxResults?: number;
        });
      case 'find_files':
        return this.findFiles(params as {
          pattern: string;
          path?: string;
          type?: 'file' | 'directory' | 'all';
          maxDepth?: number;
        });
      case 'list_files':
        return this.listFiles(params as {
          path?: string;
          recursive?: boolean;
          showHidden?: boolean;
        });
      case 'get_file_info':
        return this.getFileInfo(params.path as string);
      case 'bash':
        return this.runBash(params.command as string, params.timeout as number | undefined);
      case 'git':
        return this.runGit(params.args as string[]);
      case 'create_issue':
        // This is handled specially - just return the params
        return { result: params, output: 'Issue created' };
      case 'write_learnings':
        return this.writeLearnings(
          params.learnings as string,
          undefined, // file parameter removed, using store
          true, // append
          params.category as string | undefined ?? 'general'
        );
      case 'read_learnings':
        return this.readLearnings(undefined, params.category as string | undefined);
      case 'search_learnings':
        return this.searchLearnings(params.query as string);
      case 'run_stub_analysis':
        return this.runStaticAnalyzer('stub', params.files as string[] | undefined, params.rootDir as string | undefined);
      case 'run_duplicate_analysis':
        return this.runStaticAnalyzer('duplicate', params.files as string[] | undefined, params.rootDir as string | undefined);
      case 'run_security_analysis':
        return this.runStaticAnalyzer('security', params.files as string[] | undefined, params.rootDir as string | undefined);
      case 'run_dead_code_analysis':
        return this.runStaticAnalyzer('dead-code', params.files as string[] | undefined, params.rootDir as string | undefined);
      case 'run_bug_analysis':
        return this.runStaticAnalyzer('bug', params.files as string[] | undefined, params.rootDir as string | undefined);
      case 'run_type_analysis':
        return this.runStaticAnalyzer('type', params.files as string[] | undefined, params.rootDir as string | undefined);
      case 'run_coverage_analysis':
        return this.runStaticAnalyzer('coverage', params.files as string[] | undefined, params.rootDir as string | undefined);
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }

  /**
   * Detect project language based on files present
   */
  private async detectProjectLanguage(): Promise<string> {
    const checks: [string, string][] = [
      ['package.json', 'javascript'],
      ['tsconfig.json', 'typescript'],
      ['pyproject.toml', 'python'],
      ['setup.py', 'python'],
      ['requirements.txt', 'python'],
      ['Pipfile', 'python'],
      ['go.mod', 'go'],
      ['Cargo.toml', 'rust'],
      ['pom.xml', 'java'],
      ['build.gradle', 'java'],
      ['build.gradle.kts', 'kotlin'],
      ['Gemfile', 'ruby'],
      ['composer.json', 'php'],
      ['Makefile', 'c'],
      ['CMakeLists.txt', 'cpp'],
      ['Package.swift', 'swift'],
      ['pubspec.yaml', 'dart'],
      ['mix.exs', 'elixir'],
      ['*.sln', 'csharp'],
    ];

    for (const [file, lang] of checks) {
      try {
        if (file.includes('*')) {
          const matches = await glob(file, { cwd: this.rootDir, nodir: true });
          if (matches.length > 0) { return lang; }
        } else {
          await fs.promises.access(path.join(this.rootDir, file));
          return lang;
        }
      } catch {
        // File not found, try next
      }
    }

    // Fallback: check file extensions in root
    try {
      const files = await fs.promises.readdir(this.rootDir);
      if (files.some(f => f.endsWith('.py'))) { return 'python'; }
      if (files.some(f => f.endsWith('.go'))) { return 'go'; }
      if (files.some(f => f.endsWith('.rs'))) { return 'rust'; }
      if (files.some(f => f.endsWith('.java'))) { return 'java'; }
      if (files.some(f => f.endsWith('.rb'))) { return 'ruby'; }
      if (files.some(f => f.endsWith('.php'))) { return 'php'; }
      if (files.some(f => f.endsWith('.html'))) { return 'html'; }
      if (files.some(f => f.endsWith('.c') || f.endsWith('.cpp') || f.endsWith('.h'))) { return 'c'; }
    } catch {
      // ignore
    }

    return 'unknown';
  }

  /**
   * Auto-detect and run the appropriate linter for the project
   */
  async runLint(
    files?: string[],
    fix?: boolean
  ): Promise<{ result: unknown; output: string }> {
    const lang = await this.detectProjectLanguage();

    switch (lang) {
      case 'typescript':
      case 'javascript':
        return this.runESLint(files, fix);

      case 'python': {
        // Try ruff first (fastest), then pylint, then flake8
        const ruffResult = await this.runCommand('ruff', ['check', ...(fix === true ? ['--fix'] : []), ...(files ?? ['.'])]);
        if (ruffResult.exitCode !== 127) { // 127 = command not found
          return {
            result: ruffResult,
            output: ruffResult.output || ruffResult.stderr || 'No issues found',
          };
        }
        const pylintResult = await this.runCommand('pylint', ['--output-format=text', ...(files ?? ['.'])]);
        if (pylintResult.exitCode !== 127) {
          return {
            result: pylintResult,
            output: pylintResult.output || pylintResult.stderr || 'No issues found',
          };
        }
        const flake8Result = await this.runCommand('flake8', [...(files ?? ['.'])]);
        return {
          result: flake8Result,
          output: flake8Result.output || flake8Result.stderr || 'No Python linter available (install ruff, pylint, or flake8)',
        };
      }

      case 'go': {
        const result = await this.runCommand('golangci-lint', ['run', ...(files ?? ['./...'])]);
        if (result.exitCode === 127) {
          const vetResult = await this.runCommand('go', ['vet', ...(files ?? ['./...'])]);
          return {
            result: vetResult,
            output: vetResult.output || vetResult.stderr || 'No Go lint issues found',
          };
        }
        return {
          result,
          output: result.output || result.stderr || 'No Go lint issues found',
        };
      }

      case 'rust': {
        const result = await this.runCommand('cargo', ['clippy', '--message-format=short', '--', '-W', 'clippy::all']);
        return {
          result,
          output: result.output || result.stderr || 'No Rust lint issues found',
        };
      }

      case 'ruby': {
        const result = await this.runCommand('rubocop', ['--format', 'simple', ...(files ?? [])]);
        return {
          result,
          output: result.output || result.stderr || 'No Ruby lint issues found',
        };
      }

      case 'php': {
        const phpstanResult = await this.runCommand('phpstan', ['analyse', ...(files ?? ['.']), '--no-progress']);
        if (phpstanResult.exitCode !== 127) {
          return {
            result: phpstanResult,
            output: phpstanResult.output || phpstanResult.stderr || 'No PHP issues found',
          };
        }
        const phpcsResult = await this.runCommand('phpcs', [...(files ?? ['.'])]);
        return {
          result: phpcsResult,
          output: phpcsResult.output || phpcsResult.stderr || 'No PHP linter available (install phpstan or phpcs)',
        };
      }

      case 'c':
      case 'cpp': {
        const result = await this.runCommand('cppcheck', ['--enable=all', '--quiet', ...(files ?? ['.'])]);
        return {
          result,
          output: result.output || result.stderr || 'No C/C++ issues found',
        };
      }

      case 'java':
      case 'kotlin': {
        // Try gradle if available
        const gradleResult = await this.runCommand('./gradlew', ['check']);
        if (gradleResult.exitCode !== 127) {
          return {
            result: gradleResult,
            output: gradleResult.output || gradleResult.stderr || 'No issues found',
          };
        }
        return {
          result: { success: false, output: '' },
          output: `No linter auto-detected for ${lang}. Use bash tool to run your project's linter directly.`,
        };
      }

      default:
        return {
          result: { success: false, output: '' },
          output: `No linter auto-detected for language: ${lang}. Use the bash tool to run linting commands directly.`,
        };
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
    if (fix === true) {args.push('--fix');}

    if (files && files.length > 0) {
      args.push(...files);
    } else {
      args.push('.');
    }

    const result = await this.runCommand('npx', args);
    const issues: ESLintIssue[] = [];

    if (result.output) {
      try {
        const eslintOutput = JSON.parse(result.output) as {
          filePath: string;
          messages: {
            line: number;
            column: number;
            message: string;
            ruleId: string;
            severity: number;
          }[];
        }[];

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
        ? `Found ${String(issues.length)} ESLint issues:\n${issues.map(i => `  ${i.filePath}:${String(i.line)} - ${i.severity}: ${i.message}`).join('\n')}`
        : 'No ESLint issues found',
    };
  }

  /**
   * Run type checking - language-aware
   */
  async runTypeCheck(files?: string[]): Promise<{ result: TypeScriptError[]; output: string }> {
    const lang = await this.detectProjectLanguage();

    if (lang === 'python') {
      // Try mypy first, then pyright
      const mypyResult = await this.runCommand('mypy', [...(files ?? ['.'])]);
      if (mypyResult.exitCode !== 127) {
        return {
          result: [],
          output: mypyResult.output || mypyResult.stderr || 'No Python type errors found',
        };
      }
      const pyrightResult = await this.runCommand('pyright', [...(files ?? ['.'])]);
      return {
        result: [],
        output: pyrightResult.output || pyrightResult.stderr || 'No Python type checker available (install mypy or pyright)',
      };
    }

    if (lang === 'go') {
      const result = await this.runCommand('go', ['vet', ...(files ?? ['./...'])]);
      return {
        result: [],
        output: result.output || result.stderr || 'No Go type errors found',
      };
    }

    if (lang === 'rust') {
      const result = await this.runCommand('cargo', ['check', '--message-format=short']);
      return {
        result: [],
        output: result.output || result.stderr || 'No Rust type errors found',
      };
    }

    // Default: TypeScript
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
        filePath: match[1],
        line: parseInt(match[2], 10),
        column: parseInt(match[3], 10),
        code: parseInt(match[4], 10),
        message: match[5],
      });
    }

    return {
      result: errors,
      output: errors.length > 0
        ? `Found ${String(errors.length)} TypeScript errors:\n${errors.map(e => `  ${e.filePath}:${String(e.line)} - TS${String(e.code)}: ${e.message}`).join('\n')}`
        : 'No TypeScript errors found',
    };
  }

  /**
   * Run tests - language-aware
   */
  async runTests(
    pattern?: string,
    testName?: string
  ): Promise<{ result: TestResult; output: string }> {
    const lang = await this.detectProjectLanguage();

    let command = 'npm';
    let args = ['test'];

    if (lang === 'python') {
      command = 'pytest';
      args = ['-v'];
      if (pattern !== undefined && pattern !== '') { args.push(pattern); }
      if (testName !== undefined && testName !== '') { args.push('-k', testName); }
    } else if (lang === 'go') {
      command = 'go';
      args = ['test', '-v', ...(pattern !== undefined && pattern !== '' ? [pattern] : ['./...'])];
      if (testName !== undefined && testName !== '') { args.push('-run', testName); }
    } else if (lang === 'rust') {
      command = 'cargo';
      args = ['test'];
      if (testName !== undefined && testName !== '') { args.push(testName); }
    } else if (lang === 'ruby') {
      command = 'bundle';
      args = ['exec', 'rspec'];
      if (pattern !== undefined && pattern !== '') { args.push(pattern); }
    } else if (lang === 'php') {
      command = 'vendor/bin/phpunit';
      args = [];
      if (pattern !== undefined && pattern !== '') { args.push(pattern); }
    } else {
      // JS/TS - detect test runner
      const packageJson = await this.readPackageJson();
      if (packageJson?.scripts?.test !== undefined && packageJson.scripts.test !== '') {
        if (packageJson.scripts.test.includes('vitest')) {
          command = 'npx';
          args = ['vitest', 'run', '--reporter=json'];
          if (pattern !== undefined && pattern !== '') {args.push(pattern);}
          if (testName !== undefined && testName !== '') {args.push('-t', testName);}
        } else if (packageJson.scripts.test.includes('jest')) {
          command = 'npx';
          args = ['jest', '--json'];
          if (pattern !== undefined && pattern !== '') {args.push(pattern);}
          if (testName !== undefined && testName !== '') {args.push('-t', testName);}
        }
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
      const jsonMatch = /\{[\s\S]*"numPassedTests"[\s\S]*\}/.exec(result.output);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as {
          numPassedTests?: number;
          numFailedTests?: number;
          numPendingTests?: number;
          testResults?: {
            assertionResults?: {
              status: string;
              title: string;
              failureMessages?: string[];
            }[];
          }[];
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
      const passMatch = /(\d+)\s+(?:passing|passed)/i.exec(result.output);
      const failMatch = /(\d+)\s+(?:failing|failed)/i.exec(result.output);
      if (passMatch) {testResult.passed = parseInt(passMatch[1], 10);}
      if (failMatch) {testResult.failed = parseInt(failMatch[1], 10);}
    }

    return {
      result: testResult,
      output: `Tests: ${String(testResult.passed)} passed, ${String(testResult.failed)} failed, ${String(testResult.skipped)} skipped${
        testResult.failures.length > 0
          ? '\n\nFailures:\n' + testResult.failures.map(f => `  - ${f.testName}: ${f.error.substring(0, 200)}`).join('\n')
          : ''
      }`,
    };
  }

  /**
   * Run build - language-aware
   */
  async runBuild(): Promise<{ result: { success: boolean; errors: string[] }; output: string }> {
    const lang = await this.detectProjectLanguage();

    let command: string;
    let args: string[];

    switch (lang) {
      case 'rust':
        command = 'cargo';
        args = ['build'];
        break;
      case 'go':
        command = 'go';
        args = ['build', './...'];
        break;
      case 'java':
        // Try gradle first, then maven
        try {
          await fs.promises.access(path.join(this.rootDir, 'gradlew'));
          command = './gradlew';
          args = ['build'];
        } catch {
          command = 'mvn';
          args = ['compile'];
        }
        break;
      case 'c':
      case 'cpp':
        command = 'make';
        args = [];
        break;
      case 'csharp':
        command = 'dotnet';
        args = ['build'];
        break;
      default:
        // JS/TS default
        command = 'npm';
        args = ['run', 'build'];
        break;
    }

    const result = await this.runCommand(command, args);
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
          .map((line, i) => `${String(start + i + 1)} | ${line}`)
          .join('\n');

        return {
          result: { content: selectedLines.join('\n'), lines: selectedLines.length },
          output: `File: ${filePath} (lines ${String(start + 1)}-${String(end)})\n\n${numberedContent}`,
        };
      }

      const numberedContent = lines
        .map((line, i) => `${String(i + 1)} | ${line}`)
        .join('\n');

      return {
        result: { content, lines: lines.length },
        output: `File: ${filePath} (${String(lines.length)} lines)\n\n${numberedContent}`,
      };
    } catch {
      throw new Error(`Failed to read file: ${filePath}`);
    }
  }

  /**
   * Grep - search for patterns in files
   */
  async grep(params: {
    pattern: string;
    path?: string;
    include?: string;
    exclude?: string;
    ignoreCase?: boolean;
    contextLines?: number;
    maxResults?: number;
  }): Promise<{ result: GrepMatch[]; output: string }> {
    const {
      pattern,
      path: searchPath = '.',
      include,
      exclude = '**/node_modules/**',
      ignoreCase = false,
      contextLines = 0,
      maxResults = 100,
    } = params;

    const matches: GrepMatch[] = [];
    const regex = new RegExp(pattern, ignoreCase ? 'gi' : 'g');

    // Find files to search
    const searchDir = path.isAbsolute(searchPath)
      ? searchPath
      : path.join(this.rootDir, searchPath);

    let files: string[];
    try {
      const stat = await fs.promises.stat(searchDir);
      if (stat.isFile()) {
        files = [searchDir];
      } else {
        files = await glob(include ?? '**/*', {
          cwd: searchDir,
          absolute: true,
          ignore: exclude ? [exclude] : ['**/node_modules/**', '**/dist/**'],
          nodir: true,
        });
      }
    } catch {
      files = [];
    }

    // Search files
    for (const file of files) {
      if (matches.length >= maxResults) {break;}

      try {
        const content = await fs.promises.readFile(file, 'utf-8');
        const lines = content.split('\n');

        for (let i = 0; i < lines.length && matches.length < maxResults; i++) {
          const line = lines[i];
          regex.lastIndex = 0;
          const match = regex.exec(line);

          if (match) {
            const grepMatch: GrepMatch = {
              file: path.relative(this.rootDir, file),
              line: i + 1,
              column: match.index + 1,
              content: line.trim(),
            };

            if (contextLines > 0) {
              grepMatch.beforeContext = lines
                .slice(Math.max(0, i - contextLines), i)
                .map(l => l.trim());
              grepMatch.afterContext = lines
                .slice(i + 1, Math.min(lines.length, i + contextLines + 1))
                .map(l => l.trim());
            }

            matches.push(grepMatch);
          }
        }
      } catch {
        // Skip files that can't be read
      }
    }

    return {
      result: matches,
      output: matches.length > 0
        ? `Found ${String(matches.length)} matches for "${pattern}":\n${matches.map(m =>
            `  ${m.file}:${String(m.line)}:${String(m.column)}: ${m.content.substring(0, 100)}`
          ).join('\n')}`
        : `No matches found for "${pattern}"`,
    };
  }

  /**
   * Find files matching a pattern
   */
  async findFiles(params: {
    pattern: string;
    path?: string;
    type?: 'file' | 'directory' | 'all';
    maxDepth?: number;
  }): Promise<{ result: string[]; output: string }> {
    const {
      pattern,
      path: searchPath = '.',
      type = 'file',
      maxDepth,
    } = params;

    const searchDir = path.isAbsolute(searchPath)
      ? searchPath
      : path.join(this.rootDir, searchPath);

    const options: Parameters<typeof glob>[1] = {
      cwd: searchDir,
      ignore: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**'],
      absolute: false,
    };

    if (maxDepth !== undefined) {
      options.maxDepth = maxDepth;
    }

    let files: string[];
    if (type === 'file') {
      options.nodir = true;
      const result = await glob(pattern, options);
      files = result as string[];
    } else if (type === 'directory') {
      // For directories, get all entries and filter to directories
      const result = await glob(pattern + '/', { ...options, mark: true });
      files = (result as string[]).map(f => f.replace(/\/$/, ''));
    } else {
      const result = await glob(pattern, options);
      files = result as string[];
    }

    const sortedFiles = files.sort();

    return {
      result: sortedFiles,
      output: `Found ${String(sortedFiles.length)} ${type === 'all' ? 'entries' : type + 's'}:\n${sortedFiles.slice(0, 50).join('\n')}${sortedFiles.length > 50 ? '\n...(truncated)' : ''}`,
    };
  }

  /**
   * List files in a directory
   */
  async listFiles(params: {
    path?: string;
    recursive?: boolean;
    showHidden?: boolean;
  }): Promise<{ result: string[]; output: string }> {
    const {
      path: dirPath = '.',
      recursive = false,
      showHidden = false,
    } = params;

    const fullPath = path.isAbsolute(dirPath)
      ? dirPath
      : path.join(this.rootDir, dirPath);

    let pattern = recursive ? '**/*' : '*';
    if (!showHidden) {
      pattern = recursive ? '**/[!.]*' : '[!.]*';
    }

    const result = await glob(pattern, {
      cwd: fullPath,
      ignore: ['**/node_modules/**', '**/dist/**'],
      nodir: false,
    });
    const files = result;

    return {
      result: files.sort(),
      output: `${fullPath}:\n${files.sort().join('\n')}`,
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
      imports.push(match[1]);
    }

    // Extract exports
    const exportRegex = /export\s+(?:default\s+)?(?:const|let|var|function|class|interface|type|enum)\s+(\w+)/g;
    const exports: string[] = [];
    while ((match = exportRegex.exec(content)) !== null) {
      exports.push(match[1]);
    }

    // Extract function names
    const funcRegex = /(?:function|const|let|var)\s+(\w+)\s*(?:=\s*(?:async\s*)?[(]|[(<])/g;
    const functions: string[] = [];
    while ((match = funcRegex.exec(content)) !== null) {
      functions.push(match[1]);
    }

    // Extract class names
    const classRegex = /class\s+(\w+)/g;
    const classes: string[] = [];
    while ((match = classRegex.exec(content)) !== null) {
      classes.push(match[1]);
    }

    const info = { imports, exports, functions, classes };

    return {
      result: info,
      output: `File: ${filePath}\n\nImports (${String(imports.length)}):\n${imports.map(i => `  - ${i}`).join('\n')}\n\nExports (${String(exports.length)}):\n${exports.map(e => `  - ${e}`).join('\n')}\n\nFunctions (${String(functions.length)}):\n${functions.map(fn => `  - ${fn}`).join('\n')}\n\nClasses (${String(classes.length)}):\n${classes.map(c => `  - ${c}`).join('\n')}`,
    };
  }

  /**
   * Run a bash command (restricted)
   */
  async runBash(
    command: string,
    timeout?: number
  ): Promise<{ result: ToolResult; output: string }> {
    // Validate command
    const firstWord = command.trim().split(/\s+/)[0];
    if (!firstWord || !ALLOWED_BASH_COMMANDS.has(firstWord)) {
      throw new Error(`Command '${firstWord}' is not allowed. Allowed: ${Array.from(ALLOWED_BASH_COMMANDS).slice(0, 10).join(', ')}...`);
    }

    // Check for blocked patterns
    for (const pattern of BLOCKED_PATTERNS) {
      if (pattern.test(command)) {
        throw new Error('Command contains blocked pattern for security reasons');
      }
    }

    const result = await this.runCommand('bash', ['-c', command], timeout ?? 30000);

    return {
      result,
      output: result.success
        ? result.output !== '' ? result.output : '(no output)'
        : `Command failed (exit ${String(result.exitCode)}): ${result.stderr !== '' ? result.stderr : result.output}`,
    };
  }

  /**
   * Run a git command
   */
  async runGit(args: string[]): Promise<{ result: ToolResult; output: string }> {
    // Validate git args - block destructive operations
    const blockedGitOps = ['push', 'reset', 'clean', 'checkout', 'rebase', 'merge'];
    if (blockedGitOps.includes(args[0])) {
      throw new Error(`Git operation '${args[0]}' is not allowed for analysis`);
    }

    const result = await this.runCommand('git', args);

    return {
      result,
      output: result.success
        ? result.output || '(no output)'
        : `Git command failed: ${result.stderr || result.output}`,
    };
  }

  /**
   * Write learnings (Ralph pattern)
   * Now uses pluggable learnings store (SQLite or file-based)
   */
  async writeLearnings(
    learnings: string,
    _file?: string,
    _append = true,
    category = 'general'
  ): Promise<{ result: { written: boolean }; output: string }> {
    try {
      // Parse learnings - try to extract structured info
      const learning: LearningEntry = {
        category,
        pattern: learnings.split('\n')[0]?.slice(0, 100) ?? 'Learning',
        description: learnings,
        confidence: 0.8,
      };

      // Extract file patterns if mentioned
      const filePatternMatch = /(?:files?|patterns?):\s*([^\n]+)/i.exec(learnings);
      if (filePatternMatch) {
        learning.file_patterns = filePatternMatch[1].split(',').map(p => p.trim());
      }

      await this.learningsStore.write(learning);

      return {
        result: { written: true },
        output: `Learning recorded: ${learning.pattern.slice(0, 50)}...`,
      };
    } catch (error) {
      return {
        result: { written: false },
        output: `Failed to write learning: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Read learnings from store
   */
  async readLearnings(file?: string, category?: string): Promise<{ result: { learnings: LearningEntry[]; count: number }; output: string }> {
    try {
      const learnings = await this.learningsStore.read(category);

      if (learnings.length === 0) {
        return {
          result: { learnings: [], count: 0 },
          output: 'No previous learnings found',
        };
      }

      const output = learnings.map((l, i) =>
        `${String(i + 1)}. [${l.category}] ${l.pattern}\n   ${l.description.slice(0, 200)}${l.description.length > 200 ? '...' : ''}`
      ).join('\n\n');

      return {
        result: { learnings, count: learnings.length },
        output: `Found ${String(learnings.length)} learnings:\n\n${output}`,
      };
    } catch (error) {
      return {
        result: { learnings: [], count: 0 },
        output: `Failed to read learnings: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Search learnings by query
   */
  async searchLearnings(query: string): Promise<{ result: LearningEntry[]; output: string }> {
    try {
      const learnings = await this.learningsStore.search(query);

      if (learnings.length === 0) {
        return {
          result: [],
          output: `No learnings found matching "${query}"`,
        };
      }

      const output = learnings.map((l, i) =>
        `${String(i + 1)}. [${l.category}] ${l.pattern}`
      ).join('\n');

      return {
        result: learnings,
        output: `Found ${String(learnings.length)} learnings matching "${query}":\n${output}`,
      };
    } catch (error) {
      return {
        result: [],
        output: `Search failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Run a static analyzer by category and return formatted results
   */
  async runStaticAnalyzer(
    category: string,
    files?: string[],
    rootDir?: string
  ): Promise<{ result: Issue[]; output: string }> {
    const effectiveRootDir = rootDir ?? this.rootDir;
    const options: AnalyzerOptions = { rootDir: effectiveRootDir };

    try {
      let analyzer: { analyze(files: string[], options: AnalyzerOptions): Promise<Issue[]> };

      switch (category) {
        case 'stub': {
          const { StubAnalyzer } = await import('../stubs/index.js');
          analyzer = new StubAnalyzer();
          break;
        }
        case 'duplicate': {
          const { DuplicateAnalyzer } = await import('../duplicates/index.js');
          analyzer = new DuplicateAnalyzer();
          break;
        }
        case 'security': {
          const { SecurityAnalyzer } = await import('../security/index.js');
          analyzer = new SecurityAnalyzer();
          break;
        }
        case 'dead-code': {
          const { DeadCodeAnalyzer } = await import('../dead-code/index.js');
          analyzer = new DeadCodeAnalyzer();
          break;
        }
        case 'bug': {
          const { BugAnalyzer } = await import('../bugs/index.js');
          analyzer = new BugAnalyzer();
          break;
        }
        case 'type': {
          const { TypeAnalyzer } = await import('../types/index.js');
          analyzer = new TypeAnalyzer();
          break;
        }
        case 'coverage': {
          const { CoverageAnalyzer } = await import('../coverage/index.js');
          analyzer = new CoverageAnalyzer();
          break;
        }
        default:
          throw new Error(`Unknown analyzer category: ${category}`);
      }

      // If no files specified, discover files in the project
      let targetFiles = files ?? [];
      if (targetFiles.length === 0) {
        const patterns = ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.py', '**/*.go', '**/*.rs', '**/*.java', '**/*.rb', '**/*.php', '**/*.c', '**/*.cpp', '**/*.h'];
        for (const pattern of patterns) {
          const matches = await glob(pattern, {
            cwd: effectiveRootDir,
            absolute: true,
            ignore: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**', '**/*.d.ts'],
            nodir: true,
          });
          targetFiles.push(...matches);
        }
        targetFiles = [...new Set(targetFiles)].sort();
      }

      const issues = await analyzer.analyze(targetFiles, options);

      const output = issues.length > 0
        ? `Found ${String(issues.length)} ${category} issues:\n${issues.map(i =>
            `  ${path.relative(effectiveRootDir, i.location.file)}:${String(i.location.line)} [${i.severity}] ${i.message}`
          ).join('\n')}`
        : `No ${category} issues found`;

      return { result: issues, output };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        result: [],
        output: `Failed to run ${category} analyzer: ${errorMsg}`,
      };
    }
  }

  /**
   * Run a shell command
   */
  private async runCommand(
    command: string,
    args: string[],
    timeout?: number
  ): Promise<ToolResult> {
    const startTime = Date.now();

    return new Promise((resolve) => {
      const options: SpawnOptions = {
        cwd: this.rootDir,
        shell: true,
        timeout: timeout ?? this.timeout,
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
      return JSON.parse(content) as { scripts?: Record<string, string> };
    } catch {
      return null;
    }
  }
}
