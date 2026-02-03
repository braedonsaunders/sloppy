import { ESLint, type Linter } from 'eslint';
import * as path from 'node:path';
import {
  BaseAnalyzer,
  type Issue,
  type AnalyzerOptions,
  type Severity,
} from '../base.js';

/**
 * ESLint rule configuration
 */
type RuleConfig = Linter.RuleLevelAndOptions | Linter.RuleLevel;

/**
 * Configuration for lint analysis
 */
export interface LintAnalyzerConfig {
  /** Custom ESLint rules to add/override */
  rules?: Record<string, RuleConfig>;
  /** Use strict rule set (default: true) */
  strict?: boolean;
  /** Path to custom ESLint config file */
  configPath?: string;
  /** Whether to auto-fix issues (default: false) */
  fix?: boolean;
  /** Extensions to lint (default: .ts, .tsx, .js, .jsx) */
  extensions?: string[];
}

/**
 * Strict ESLint rules for code quality
 */
const STRICT_RULES: Record<string, RuleConfig> = {
  // Possible problems
  'no-console': 'warn',
  'no-debugger': 'error',
  'no-duplicate-imports': 'error',
  'no-self-compare': 'error',
  'no-template-curly-in-string': 'warn',
  'no-unmodified-loop-condition': 'error',
  'no-unreachable-loop': 'error',
  'no-use-before-define': 'error',
  'require-atomic-updates': 'error',

  // Suggestions
  'arrow-body-style': ['warn', 'as-needed'],
  'camelcase': 'warn',
  'complexity': ['warn', 15],
  'consistent-return': 'error',
  'curly': ['error', 'all'],
  'default-case': 'warn',
  'default-case-last': 'error',
  'dot-notation': 'warn',
  'eqeqeq': ['error', 'always'],
  'func-style': ['warn', 'declaration', { allowArrowFunctions: true }],
  'max-depth': ['warn', 4],
  'max-lines-per-function': ['warn', { max: 100, skipBlankLines: true, skipComments: true }],
  'max-nested-callbacks': ['warn', 4],
  'max-params': ['warn', 5],
  'no-alert': 'error',
  'no-caller': 'error',
  'no-else-return': 'warn',
  'no-empty-function': 'warn',
  'no-eval': 'error',
  'no-extend-native': 'error',
  'no-extra-bind': 'warn',
  'no-floating-decimal': 'warn',
  'no-implicit-coercion': 'warn',
  'no-implied-eval': 'error',
  'no-invalid-this': 'error',
  'no-labels': 'error',
  'no-lone-blocks': 'warn',
  'no-lonely-if': 'warn',
  'no-loop-func': 'error',
  'no-magic-numbers': ['warn', { ignore: [-1, 0, 1, 2], ignoreArrayIndexes: true }],
  'no-multi-assign': 'error',
  'no-nested-ternary': 'warn',
  'no-new': 'warn',
  'no-new-func': 'error',
  'no-new-wrappers': 'error',
  'no-param-reassign': 'warn',
  'no-return-assign': 'error',
  'no-return-await': 'warn',
  'no-sequences': 'error',
  'no-shadow': 'warn',
  'no-throw-literal': 'error',
  'no-undef-init': 'warn',
  'no-undefined': 'off', // TypeScript handles this
  'no-unneeded-ternary': 'warn',
  'no-unused-expressions': 'error',
  'no-useless-concat': 'warn',
  'no-useless-return': 'warn',
  'no-var': 'error',
  'no-void': 'warn',
  'object-shorthand': 'warn',
  'prefer-arrow-callback': 'warn',
  'prefer-const': 'error',
  'prefer-destructuring': ['warn', { array: false, object: true }],
  'prefer-object-spread': 'warn',
  'prefer-promise-reject-errors': 'error',
  'prefer-rest-params': 'error',
  'prefer-spread': 'warn',
  'prefer-template': 'warn',
  'radix': 'error',
  'require-await': 'warn',
  'sort-imports': ['warn', { ignoreDeclarationSort: true }],
  'spaced-comment': ['warn', 'always'],
  'yoda': 'warn',
};

/**
 * Analyzer that runs ESLint programmatically
 */
export class LintAnalyzer extends BaseAnalyzer {
  readonly name = 'lint-analyzer';
  readonly description = 'Runs ESLint to detect code style and quality issues';
  readonly category = 'lint' as const;

  private eslint: ESLint | null = null;

  async analyze(files: string[], options: AnalyzerOptions): Promise<Issue[]> {
    const issues: Issue[] = [];
    const config = this.getConfig(options);

    try {
      // Create ESLint instance
      this.eslint = await this.createESLint(options.rootDir, config);

      // Filter files by extension
      const lintableFiles = this.filterLintableFiles(files, config);

      if (lintableFiles.length === 0) {
        this.log(options, 'No lintable files found');
        return issues;
      }

      this.log(options, `Linting ${lintableFiles.length} files`);

      // Run ESLint
      const results = await this.eslint.lintFiles(lintableFiles);

      // Convert ESLint results to issues
      for (const result of results) {
        if (result.messages.length > 0) {
          const fileIssues = this.convertResultToIssues(result);
          issues.push(...fileIssues);
        }
      }

      this.log(options, `Found ${issues.length} lint issues`);
    } catch (error) {
      this.logError('Failed to run ESLint', error);
    }

    return issues;
  }

  /**
   * Get configuration from options
   */
  private getConfig(options: AnalyzerOptions): Required<LintAnalyzerConfig> {
    const userConfig = options.config as LintAnalyzerConfig | undefined;
    return {
      rules: userConfig?.rules ?? {},
      strict: userConfig?.strict ?? true,
      configPath: userConfig?.configPath ?? '',
      fix: userConfig?.fix ?? false,
      extensions: userConfig?.extensions ?? ['.ts', '.tsx', '.js', '.jsx'],
    };
  }

  /**
   * Create ESLint instance with configuration
   */
  private async createESLint(
    rootDir: string,
    config: Required<LintAnalyzerConfig>
  ): Promise<ESLint> {
    // Build rules configuration
    const rules: Record<string, RuleConfig> = {};

    // Add strict rules if enabled
    if (config.strict) {
      Object.assign(rules, STRICT_RULES);
    }

    // Override with user rules
    Object.assign(rules, config.rules);

    const eslintOptions: ESLint.Options = {
      cwd: rootDir,
      fix: config.fix,
      overrideConfigFile: config.configPath || undefined,
      overrideConfig: {
        rules,
        languageOptions: {
          ecmaVersion: 2022,
          sourceType: 'module',
          parserOptions: {
            ecmaFeatures: {
              jsx: true,
            },
          },
        },
      },
      errorOnUnmatchedPattern: false,
    };

    return new ESLint(eslintOptions);
  }

  /**
   * Filter files to only include lintable extensions
   */
  private filterLintableFiles(
    files: string[],
    config: Required<LintAnalyzerConfig>
  ): string[] {
    return files.filter((file) => {
      const ext = path.extname(file);
      return config.extensions.includes(ext);
    });
  }

  /**
   * Convert ESLint result to Issue array
   */
  private convertResultToIssues(result: ESLint.LintResult): Issue[] {
    const issues: Issue[] = [];

    for (const message of result.messages) {
      issues.push(
        this.createIssue({
          id: this.generateIssueId(
            this.category,
            result.filePath,
            message.line ?? 1,
            message.ruleId ?? 'unknown'
          ),
          severity: this.eslintSeverityToSeverity(message.severity),
          message: message.message,
          description: message.ruleId
            ? `ESLint rule: ${message.ruleId}`
            : undefined,
          location: {
            file: result.filePath,
            line: message.line ?? 1,
            column: message.column ?? 1,
            endLine: message.endLine,
            endColumn: message.endColumn,
          },
          suggestion: message.fix
            ? 'This issue can be auto-fixed with --fix'
            : undefined,
          metadata: {
            ruleId: message.ruleId,
            nodeType: message.nodeType,
            fatal: message.fatal,
            fix: message.fix
              ? {
                  range: message.fix.range,
                  text: message.fix.text,
                }
              : undefined,
          },
        })
      );
    }

    return issues;
  }

  /**
   * Convert ESLint severity to Issue severity
   */
  private eslintSeverityToSeverity(eslintSeverity: 0 | 1 | 2): Severity {
    switch (eslintSeverity) {
      case 2:
        return 'error';
      case 1:
        return 'warning';
      default:
        return 'info';
    }
  }

  /**
   * Get the fix count for the last lint run
   */
  async getFixableCount(files: string[], options: AnalyzerOptions): Promise<number> {
    if (!this.eslint) {
      return 0;
    }

    const results = await this.eslint.lintFiles(files);
    let fixableCount = 0;

    for (const result of results) {
      fixableCount += result.fixableErrorCount + result.fixableWarningCount;
    }

    return fixableCount;
  }

  /**
   * Apply fixes to files
   */
  async applyFixes(files: string[], options: AnalyzerOptions): Promise<number> {
    const config = this.getConfig(options);
    config.fix = true;

    const eslint = await this.createESLint(options.rootDir, config);
    const results = await eslint.lintFiles(files);

    // Write fixed files
    await ESLint.outputFixes(results);

    // Count fixed issues
    let fixedCount = 0;
    for (const result of results) {
      if (result.output !== undefined) {
        fixedCount += result.fixableErrorCount + result.fixableWarningCount;
      }
    }

    return fixedCount;
  }
}
