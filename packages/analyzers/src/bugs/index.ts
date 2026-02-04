import * as ts from 'typescript';
import * as path from 'node:path';
import {
  BaseAnalyzer,
  type Issue,
  type AnalyzerOptions,
  type Severity,
} from '../base.js';

/**
 * Bug patterns to detect
 */
type BugPattern =
  | 'null-reference'
  | 'undefined-access'
  | 'array-bounds'
  | 'unreachable-code'
  | 'unused-variable'
  | 'promise-no-await'
  | 'nan-comparison'
  | 'assignment-in-condition'
  | 'type-coercion'
  | 'shadowed-variable';

/**
 * Configuration for bug detection
 */
export interface BugAnalyzerConfig {
  /** Patterns to check (default: all) */
  patterns?: BugPattern[];
  /** Whether to use strict null checks (default: true) */
  strictNullChecks?: boolean;
}

/**
 * Analyzer for detecting common bug patterns using TypeScript compiler API
 */
export class BugAnalyzer extends BaseAnalyzer {
  readonly name = 'bug-analyzer';
  readonly description = 'Detects common bug patterns using type-aware analysis';
  readonly category = 'bug' as const;

  private readonly defaultPatterns: BugPattern[] = [
    'null-reference',
    'undefined-access',
    'array-bounds',
    'unreachable-code',
    'unused-variable',
    'promise-no-await',
    'nan-comparison',
    'assignment-in-condition',
    'type-coercion',
    'shadowed-variable',
  ];

  analyze(files: string[], options: AnalyzerOptions): Promise<Issue[]> {
    const issues: Issue[] = [];
    const config = this.getConfig(options);

    try {
      // Find tsconfig.json
      const tsconfigPath = this.findTsConfig(options.rootDir);

      // Create TypeScript program
      const program = this.createProgram(files, tsconfigPath, config);
      const checker = program.getTypeChecker();

      // Analyze each source file
      for (const file of files) {
        const sourceFile = program.getSourceFile(file);
        if (!sourceFile) {
          continue;
        }

        try {
          const fileIssues = this.analyzeSourceFile(
            sourceFile,
            checker,
            program,
            config,
            options
          );
          issues.push(...fileIssues);
        } catch (error) {
          this.logError(`Failed to analyze ${file}`, error);
        }
      }

      this.log(options, `Analyzed ${String(files.length)} files, found ${String(issues.length)} potential bugs`);
    } catch (error) {
      this.logError('Failed to create TypeScript program', error);
    }

    return Promise.resolve(issues);
  }

  /**
   * Get configuration from options
   */
  private getConfig(options: AnalyzerOptions): Required<BugAnalyzerConfig> {
    const userConfig = options.config as BugAnalyzerConfig | undefined;
    return {
      patterns: userConfig?.patterns ?? this.defaultPatterns,
      strictNullChecks: userConfig?.strictNullChecks ?? true,
    };
  }

  /**
   * Find tsconfig.json in the project
   */
  private findTsConfig(rootDir: string): string | undefined {
    const possiblePaths = [
      path.join(rootDir, 'tsconfig.json'),
      path.join(rootDir, 'tsconfig.build.json'),
    ];

    for (const configPath of possiblePaths) {
      if (ts.sys.fileExists(configPath)) {
        return configPath;
      }
    }

    return undefined;
  }

  /**
   * Create TypeScript program for analysis
   */
  private createProgram(
    files: string[],
    tsconfigPath: string | undefined,
    config: Required<BugAnalyzerConfig>
  ): ts.Program {
    let compilerOptions: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      strict: true,
      strictNullChecks: config.strictNullChecks,
      noUnusedLocals: true,
      noUnusedParameters: true,
      allowJs: true,
      checkJs: true,
      skipLibCheck: true,
    };

    if (tsconfigPath !== undefined && tsconfigPath !== '') {
      const configFile = ts.readConfigFile(tsconfigPath, (p: string) => ts.sys.readFile(p));
      if (!configFile.error) {
        const parsed = ts.parseJsonConfigFileContent(
          configFile.config,
          ts.sys,
          path.dirname(tsconfigPath)
        );
        compilerOptions = { ...compilerOptions, ...parsed.options };
      }
    }

    return ts.createProgram(files, compilerOptions);
  }

  /**
   * Analyze a single source file
   */
  private analyzeSourceFile(
    sourceFile: ts.SourceFile,
    checker: ts.TypeChecker,
    program: ts.Program,
    config: Required<BugAnalyzerConfig>,
    _options: AnalyzerOptions
  ): Issue[] {
    const issues: Issue[] = [];
    const patterns = new Set(config.patterns);

    // Get pre-emit diagnostics from TypeScript
    const diagnostics = ts.getPreEmitDiagnostics(program, sourceFile);
    for (const diagnostic of diagnostics) {
      const issue = this.diagnosticToIssue(diagnostic, sourceFile);
      if (issue) {
        issues.push(issue);
      }
    }

    // Walk the AST to find additional bug patterns
    const visit = (node: ts.Node): void => {
      // Check for NaN comparison
      if (patterns.has('nan-comparison') && ts.isBinaryExpression(node)) {
        const nanIssue = this.checkNaNComparison(node, sourceFile);
        if (nanIssue) {
          issues.push(nanIssue);
        }
      }

      // Check for assignment in condition
      if (patterns.has('assignment-in-condition')) {
        const assignIssue = this.checkAssignmentInCondition(node, sourceFile);
        if (assignIssue) {
          issues.push(assignIssue);
        }
      }

      // Check for promise without await
      if (patterns.has('promise-no-await')) {
        const promiseIssue = this.checkPromiseWithoutAwait(node, checker, sourceFile);
        if (promiseIssue) {
          issues.push(promiseIssue);
        }
      }

      // Check for potential null/undefined access
      if (patterns.has('null-reference') || patterns.has('undefined-access')) {
        const nullIssue = this.checkNullAccess(node, checker, sourceFile);
        if (nullIssue) {
          issues.push(nullIssue);
        }
      }

      // Check for array bounds issues
      if (patterns.has('array-bounds')) {
        const boundsIssue = this.checkArrayBounds(node, checker, sourceFile);
        if (boundsIssue) {
          issues.push(boundsIssue);
        }
      }

      // Check for unreachable code
      if (patterns.has('unreachable-code')) {
        const unreachableIssue = this.checkUnreachableCode(node, sourceFile);
        if (unreachableIssue) {
          issues.push(unreachableIssue);
        }
      }

      // Check for type coercion issues
      if (patterns.has('type-coercion')) {
        const coercionIssue = this.checkTypeCoercion(node, sourceFile);
        if (coercionIssue) {
          issues.push(coercionIssue);
        }
      }

      // Check for shadowed variables
      if (patterns.has('shadowed-variable')) {
        const shadowIssue = this.checkShadowedVariable(node, sourceFile);
        if (shadowIssue) {
          issues.push(shadowIssue);
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    return issues;
  }

  /**
   * Convert TypeScript diagnostic to Issue
   */
  private diagnosticToIssue(
    diagnostic: ts.Diagnostic,
    sourceFile: ts.SourceFile
  ): Issue | null {
    if (!diagnostic.file || diagnostic.start === undefined) {
      return null;
    }

    const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(
      diagnostic.start
    );

    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
    const severity = this.diagnosticCategoryToSeverity(diagnostic.category);

    return this.createIssue({
      severity,
      message,
      location: {
        file: sourceFile.fileName,
        line: line + 1,
        column: character + 1,
      },
      metadata: {
        code: diagnostic.code,
        source: 'typescript',
      },
    });
  }

  /**
   * Check for NaN comparisons (always false/true)
   */
  private checkNaNComparison(
    node: ts.BinaryExpression,
    sourceFile: ts.SourceFile
  ): Issue | null {
    const isComparison = [
      ts.SyntaxKind.EqualsEqualsToken,
      ts.SyntaxKind.EqualsEqualsEqualsToken,
      ts.SyntaxKind.ExclamationEqualsToken,
      ts.SyntaxKind.ExclamationEqualsEqualsToken,
    ].includes(node.operatorToken.kind);

    if (!isComparison) {
      return null;
    }

    const isNaN = (n: ts.Expression): boolean => {
      return ts.isIdentifier(n) && n.text === 'NaN';
    };

    if (isNaN(node.left) || isNaN(node.right)) {
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(
        node.getStart()
      );

      return this.createIssue({
        severity: 'error',
        message: 'Comparison with NaN always evaluates to false',
        description: 'Use Number.isNaN() or Object.is() to check for NaN values.',
        location: {
          file: sourceFile.fileName,
          line: line + 1,
          column: character + 1,
        },
        suggestion: 'Replace with Number.isNaN(value)',
      });
    }

    return null;
  }

  /**
   * Check for assignment in condition (likely a bug)
   */
  private checkAssignmentInCondition(
    node: ts.Node,
    sourceFile: ts.SourceFile
  ): Issue | null {
    // Check if, while, for conditions
    let condition: ts.Expression | undefined;

    if (ts.isIfStatement(node)) {
      condition = node.expression;
    } else if (ts.isWhileStatement(node)) {
      condition = node.expression;
    } else if (ts.isForStatement(node) && node.condition) {
      condition = node.condition;
    }

    if (!condition) {
      return null;
    }

    // Look for assignment expression in condition
    if (ts.isBinaryExpression(condition) &&
        condition.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(
        condition.getStart()
      );

      return this.createIssue({
        severity: 'warning',
        message: 'Assignment in condition - did you mean to use === or ==?',
        description: 'Using assignment (=) instead of comparison (===) in conditions is often a bug.',
        location: {
          file: sourceFile.fileName,
          line: line + 1,
          column: character + 1,
        },
        suggestion: 'If intentional, wrap in extra parentheses: if ((x = value))',
      });
    }

    return null;
  }

  /**
   * Check for promises without await
   */
  private checkPromiseWithoutAwait(
    node: ts.Node,
    checker: ts.TypeChecker,
    sourceFile: ts.SourceFile
  ): Issue | null {
    // Check for expression statements that return a Promise
    if (!ts.isExpressionStatement(node)) {
      return null;
    }

    const expression = node.expression;

    // Skip if it's already awaited
    if (ts.isAwaitExpression(expression)) {
      return null;
    }

    // Check if the expression type is a Promise
    try {
      const type = checker.getTypeAtLocation(expression);
      const typeStr = checker.typeToString(type);

      if (typeStr.includes('Promise<')) {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(
          node.getStart()
        );

        return this.createIssue({
          severity: 'warning',
          message: 'Promise returned without await',
          description: `This expression returns a Promise but the result is not awaited. Type: ${typeStr}`,
          location: {
            file: sourceFile.fileName,
            line: line + 1,
            column: character + 1,
          },
          suggestion: 'Add await keyword or handle the Promise with .then()/.catch()',
        });
      }
    } catch {
      // Type checking failed, skip this check
    }

    return null;
  }

  /**
   * Check for potential null/undefined access
   */
  private checkNullAccess(
    node: ts.Node,
    checker: ts.TypeChecker,
    sourceFile: ts.SourceFile
  ): Issue | null {
    // Check property access expressions
    if (!ts.isPropertyAccessExpression(node) && !ts.isElementAccessExpression(node)) {
      return null;
    }

    // Skip if using optional chaining
    if (node.questionDotToken) {
      return null;
    }

    try {
      const objectExpr = ts.isPropertyAccessExpression(node)
        ? node.expression
        : node.expression;
      const type = checker.getTypeAtLocation(objectExpr);
      const typeStr = checker.typeToString(type);

      // Check if type could be null or undefined
      const isNullable =
        typeStr.includes('null') ||
        typeStr.includes('undefined') ||
        typeStr === 'any';

      if (isNullable && !typeStr.includes('| null') && !typeStr.includes('| undefined')) {
        // Type is explicitly nullable, suggest optional chaining
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(
          node.getStart()
        );

        return this.createIssue({
          severity: 'warning',
          message: 'Potential null/undefined access without guard',
          description: `Accessing property on value that could be null/undefined. Type: ${typeStr}`,
          location: {
            file: sourceFile.fileName,
            line: line + 1,
            column: character + 1,
          },
          suggestion: 'Use optional chaining (?.) or add a null check',
        });
      }
    } catch {
      // Type checking failed, skip
    }

    return null;
  }

  /**
   * Check for potential array bounds issues
   */
  private checkArrayBounds(
    node: ts.Node,
    checker: ts.TypeChecker,
    sourceFile: ts.SourceFile
  ): Issue | null {
    // Check element access expressions with numeric index
    if (!ts.isElementAccessExpression(node)) {
      return null;
    }

    const indexArg = node.argumentExpression;

    // Check for negative index
    if (ts.isPrefixUnaryExpression(indexArg) &&
        indexArg.operator === ts.SyntaxKind.MinusToken &&
        ts.isNumericLiteral(indexArg.operand)) {
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(
        node.getStart()
      );

      return this.createIssue({
        severity: 'error',
        message: 'Negative array index will return undefined',
        description: 'JavaScript arrays do not support negative indexing like Python.',
        location: {
          file: sourceFile.fileName,
          line: line + 1,
          column: character + 1,
        },
        suggestion: 'Use array.at(-n) for negative indexing or array[array.length - n]',
      });
    }

    return null;
  }

  /**
   * Check for unreachable code after return/throw
   */
  private checkUnreachableCode(
    node: ts.Node,
    sourceFile: ts.SourceFile
  ): Issue | null {
    if (!ts.isBlock(node)) {
      return null;
    }

    const statements = node.statements;
    let foundTerminator = false;

    for (const stmt of statements) {
      if (foundTerminator) {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(
          stmt.getStart()
        );

        return this.createIssue({
          severity: 'error',
          message: 'Unreachable code detected',
          description: 'This code will never execute because it follows a return, throw, or break statement.',
          location: {
            file: sourceFile.fileName,
            line: line + 1,
            column: character + 1,
          },
          suggestion: 'Remove the unreachable code or restructure the logic',
        });
      }

      if (ts.isReturnStatement(stmt) ||
          ts.isThrowStatement(stmt) ||
          ts.isBreakStatement(stmt) ||
          ts.isContinueStatement(stmt)) {
        foundTerminator = true;
      }
    }

    return null;
  }

  /**
   * Check for implicit type coercion issues
   */
  private checkTypeCoercion(
    node: ts.Node,
    sourceFile: ts.SourceFile
  ): Issue | null {
    // Check for == and != (loose equality)
    if (ts.isBinaryExpression(node)) {
      if (node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken ||
          node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsToken) {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(
          node.operatorToken.getStart()
        );

        return this.createIssue({
          severity: 'info',
          message: 'Loose equality used - consider strict equality',
          description: 'Using == or != can lead to unexpected type coercion.',
          location: {
            file: sourceFile.fileName,
            line: line + 1,
            column: character + 1,
          },
          suggestion: 'Use === or !== for strict equality comparison',
        });
      }
    }

    return null;
  }

  /**
   * Check for shadowed variables
   */
  private checkShadowedVariable(
    node: ts.Node,
    sourceFile: ts.SourceFile
  ): Issue | null {
    // Check for variable declarations
    if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name)) {
      return null;
    }

    const varName = node.name.text;

    // Walk up the scope chain to find shadowed variables
    // Navigate up the tree: VariableDeclaration -> VariableDeclarationList -> VariableStatement -> Block/Function
    const parentNode = node.parent;
    const grandParent = parentNode.parent;
    let parent: ts.Node | undefined = grandParent.parent as ts.Node | undefined; // Go up to block/function level

    while (parent) {
      if (ts.isFunctionDeclaration(parent) ||
          ts.isFunctionExpression(parent) ||
          ts.isArrowFunction(parent)) {
        // Check parameters
        for (const param of parent.parameters) {
          if (ts.isIdentifier(param.name) && param.name.text === varName) {
            const { line, character } = sourceFile.getLineAndCharacterOfPosition(
              node.getStart()
            );

            return this.createIssue({
              severity: 'warning',
              message: `Variable '${varName}' shadows a parameter`,
              description: 'This variable has the same name as a function parameter, which can lead to confusion.',
              location: {
                file: sourceFile.fileName,
                line: line + 1,
                column: character + 1,
              },
              suggestion: 'Use a different variable name to avoid confusion',
            });
          }
        }
      }
      parent = parent.parent;
    }

    return null;
  }

  /**
   * Convert diagnostic category to severity
   */
  private diagnosticCategoryToSeverity(
    category: ts.DiagnosticCategory
  ): Severity {
    switch (category) {
      case ts.DiagnosticCategory.Error:
        return 'error';
      case ts.DiagnosticCategory.Warning:
        return 'warning';
      case ts.DiagnosticCategory.Suggestion:
        return 'hint';
      default:
        return 'info';
    }
  }
}
