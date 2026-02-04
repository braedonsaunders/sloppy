import { parse } from '@typescript-eslint/typescript-estree';
import type { TSESTree } from '@typescript-eslint/typescript-estree';
import {
  BaseAnalyzer,
  type Issue,
  type AnalyzerOptions,
  type FileContent,
  type Severity,
} from '../base.js';

/**
 * Patterns that indicate stub comments
 */
const STUB_COMMENT_PATTERNS = [
  /\bTODO\b/i,
  /\bFIXME\b/i,
  /\bHACK\b/i,
  /\bXXX\b/i,
  /\bSTUB\b/i,
  /\bNOT\s+IMPLEMENTED\b/i,
  /\bPLACEHOLDER\b/i,
  /\bTEMP(ORARY)?\b/i,
  /\bWIP\b/i,
];

/**
 * Placeholder return values that indicate stubs
 */
const PLACEHOLDER_VALUES = [
  'null',
  'undefined',
  '{}',
  '[]',
  '-1',
  '0',
  '""',
  "''",
  '``',
  'false',
  'true',
  '"TODO"',
  "'TODO'",
  '"not implemented"',
  "'not implemented'",
  '"placeholder"',
  "'placeholder'",
];

/**
 * Error messages that indicate stub implementations
 */
const STUB_ERROR_PATTERNS = [
  /not\s*implemented/i,
  /not\s*yet\s*implemented/i,
  /todo/i,
  /stub/i,
  /placeholder/i,
  /implement\s*me/i,
  /needs?\s*implementation/i,
];

/**
 * Analyzer for detecting stub code and placeholder implementations
 */
export class StubAnalyzer extends BaseAnalyzer {
  readonly name = 'stub-analyzer';
  readonly description = 'Detects stub code, placeholders, and incomplete implementations';
  readonly category = 'stub' as const;

  async analyze(files: string[], options: AnalyzerOptions): Promise<Issue[]> {
    const issues: Issue[] = [];
    const fileContents = await this.readFiles(files);

    for (const file of fileContents) {
      try {
        const fileIssues = await this.analyzeFile(file, options);
        issues.push(...fileIssues);
      } catch (error) {
        this.logError(`Failed to analyze ${file.path}`, error);
      }
    }

    return issues;
  }

  private async analyzeFile(
    file: FileContent,
    options: AnalyzerOptions
  ): Promise<Issue[]> {
    const issues: Issue[] = [];

    // First, detect stub comments using simple line scanning
    const commentIssues = this.detectStubComments(file);
    issues.push(...commentIssues);

    // Then use AST parsing for more accurate function analysis
    try {
      const ast = parse(file.content, {
        loc: true,
        range: true,
        comment: true,
        jsx: file.path.endsWith('.tsx') || file.path.endsWith('.jsx'),
        errorOnUnknownASTType: false,
      });

      // Analyze AST for stub patterns
      const astIssues = this.analyzeAST(ast, file, options);
      issues.push(...astIssues);
    } catch (error) {
      // If parsing fails, fall back to regex-based detection
      this.log(options, `AST parsing failed for ${file.path}, using fallback detection`);
      const fallbackIssues = this.fallbackDetection(file);
      issues.push(...fallbackIssues);
    }

    return issues;
  }

  /**
   * Detect stub-indicating comments in the code
   */
  private detectStubComments(file: FileContent): Issue[] {
    const issues: Issue[] = [];

    for (let i = 0; i < file.lines.length; i++) {
      const line = file.lines[i] ?? '';
      const lineNumber = i + 1;

      for (const pattern of STUB_COMMENT_PATTERNS) {
        const match = line.match(pattern);
        if (match) {
          // Verify it's actually in a comment
          const commentMatch = line.match(/\/\/.*|\/\*.*?\*\/|\/\*.*$/);
          if (commentMatch) {
            const severity = this.getCommentSeverity(match[0] ?? '');
            issues.push(
              this.createIssue({
                id: this.generateIssueId(
                  this.category,
                  file.path,
                  lineNumber,
                  match[0]?.toLowerCase()
                ),
                severity,
                message: `${match[0]} comment found`,
                description: `This comment indicates incomplete or temporary code that needs attention.`,
                location: {
                  file: file.path,
                  line: lineNumber,
                  column: (match.index ?? 0) + 1,
                },
                context: this.extractContext(file.lines, lineNumber),
                suggestion: 'Complete the implementation and remove the comment',
              })
            );
            break; // Only report one issue per line
          }
        }
      }
    }

    return issues;
  }

  /**
   * Analyze AST for stub patterns
   */
  private analyzeAST(
    ast: TSESTree.Program,
    file: FileContent,
    options: AnalyzerOptions
  ): Issue[] {
    const issues: Issue[] = [];

    this.traverseAST(ast, (node) => {
      // Check function declarations
      if (
        node.type === 'FunctionDeclaration' ||
        node.type === 'FunctionExpression' ||
        node.type === 'ArrowFunctionExpression'
      ) {
        const funcIssues = this.analyzeFunctionBody(node, file);
        issues.push(...funcIssues);
      }

      // Check method definitions in classes
      if (node.type === 'MethodDefinition' && node.value && node.value.type === 'FunctionExpression') {
        const funcIssues = this.analyzeFunctionBody(node.value, file, this.getMethodName(node));
        issues.push(...funcIssues);
      }
    });

    return issues;
  }

  /**
   * Analyze a function body for stub patterns
   */
  private analyzeFunctionBody(
    node: TSESTree.FunctionDeclaration | TSESTree.FunctionExpression | TSESTree.ArrowFunctionExpression,
    file: FileContent,
    methodName?: string
  ): Issue[] {
    const issues: Issue[] = [];
    const funcName = methodName ?? this.getFunctionName(node) ?? 'anonymous function';
    const body = node.body;

    if (!body || !node.loc) {
      return issues;
    }

    // Check for empty function body
    if (this.isEmptyBody(body)) {
      issues.push(
        this.createIssue({
          severity: 'warning',
          message: `Empty function body in '${funcName}'`,
          description: 'This function has no implementation.',
          location: {
            file: file.path,
            line: node.loc.start.line,
            column: node.loc.start.column + 1,
            endLine: node.loc.end.line,
            endColumn: node.loc.end.column + 1,
          },
          context: this.extractContext(file.lines, node.loc.start.line),
          suggestion: 'Implement the function body or remove if unused',
        })
      );
      return issues;
    }

    // Get the statements from the body
    const statements = this.getBodyStatements(body);

    // Check for functions that only throw NotImplementedError
    if (this.onlyThrowsNotImplemented(statements)) {
      issues.push(
        this.createIssue({
          severity: 'error',
          message: `Function '${funcName}' throws "not implemented" error`,
          description: 'This function only throws an error indicating it is not implemented.',
          location: {
            file: file.path,
            line: node.loc.start.line,
            column: node.loc.start.column + 1,
            endLine: node.loc.end.line,
            endColumn: node.loc.end.column + 1,
          },
          context: this.extractContext(file.lines, node.loc.start.line),
          suggestion: 'Implement the function or mark it as abstract',
        })
      );
      return issues;
    }

    // Check for functions that return placeholder values
    const placeholderReturn = this.hasPlaceholderReturn(statements);
    if (placeholderReturn) {
      issues.push(
        this.createIssue({
          severity: 'warning',
          message: `Function '${funcName}' returns placeholder value: ${placeholderReturn}`,
          description: 'This function returns a value that appears to be a placeholder.',
          location: {
            file: file.path,
            line: node.loc.start.line,
            column: node.loc.start.column + 1,
            endLine: node.loc.end.line,
            endColumn: node.loc.end.column + 1,
          },
          context: this.extractContext(file.lines, node.loc.start.line),
          suggestion: 'Return a meaningful value or implement proper logic',
        })
      );
    }

    // Check for functions with only console.log/print statements
    if (this.onlyHasLogging(statements)) {
      issues.push(
        this.createIssue({
          severity: 'warning',
          message: `Function '${funcName}' only contains logging statements`,
          description: 'This function appears to be a stub with only debug logging.',
          location: {
            file: file.path,
            line: node.loc.start.line,
            column: node.loc.start.column + 1,
            endLine: node.loc.end.line,
            endColumn: node.loc.end.column + 1,
          },
          context: this.extractContext(file.lines, node.loc.start.line),
          suggestion: 'Implement the actual function logic',
        })
      );
    }

    return issues;
  }

  /**
   * Check if a function body is empty
   */
  private isEmptyBody(body: TSESTree.BlockStatement | TSESTree.Expression): boolean {
    if (body.type === 'BlockStatement') {
      if (body.body.length === 0) {
        return true;
      }
      // Check if only contains empty return or pass-like statements
      if (body.body.length === 1) {
        const stmt = body.body[0];
        if (stmt?.type === 'ReturnStatement' && !stmt.argument) {
          return true;
        }
        if (stmt?.type === 'EmptyStatement') {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Get statements from function body
   */
  private getBodyStatements(body: TSESTree.BlockStatement | TSESTree.Expression): TSESTree.Statement[] {
    if (body.type === 'BlockStatement') {
      return body.body;
    }
    // For arrow functions with expression body, wrap in synthetic return
    return [];
  }

  /**
   * Check if function only throws not implemented error
   */
  private onlyThrowsNotImplemented(statements: TSESTree.Statement[]): boolean {
    if (statements.length !== 1) {
      return false;
    }

    const stmt = statements[0];
    if (stmt?.type !== 'ThrowStatement' || !stmt.argument) {
      return false;
    }

    const throwArg = stmt.argument;

    // Check for throw new Error('not implemented')
    if (throwArg.type === 'NewExpression') {
      const callee = throwArg.callee;
      if (callee.type === 'Identifier' &&
          (callee.name === 'Error' || callee.name === 'NotImplementedError')) {
        const args = throwArg.arguments;
        if (args.length > 0) {
          const arg = args[0];
          if (arg?.type === 'Literal' && typeof arg.value === 'string') {
            return STUB_ERROR_PATTERNS.some((pattern) => pattern.test(arg.value as string));
          }
        }
        // throw new NotImplementedError() without message
        if (callee.name === 'NotImplementedError') {
          return true;
        }
      }
    }

    // Check for throw 'not implemented'
    if (throwArg.type === 'Literal' && typeof throwArg.value === 'string') {
      return STUB_ERROR_PATTERNS.some((pattern) => pattern.test(throwArg.value as string));
    }

    return false;
  }

  /**
   * Check if function returns a placeholder value
   */
  private hasPlaceholderReturn(statements: TSESTree.Statement[]): string | null {
    if (statements.length !== 1) {
      return null;
    }

    const stmt = statements[0];
    if (stmt?.type !== 'ReturnStatement' || !stmt.argument) {
      return null;
    }

    const arg = stmt.argument;

    // Check literal values
    if (arg.type === 'Literal') {
      // Use type assertion through unknown to avoid complex type narrowing issues
      const literalNode = arg as unknown as { raw?: string; value: unknown };
      const rawValue = literalNode.raw ?? String(literalNode.value);
      if (PLACEHOLDER_VALUES.includes(rawValue)) {
        return rawValue;
      }
      // Check for TODO/placeholder in string values
      const litValue = literalNode.value;
      if (typeof litValue === 'string') {
        if (STUB_ERROR_PATTERNS.some((p) => p.test(litValue))) {
          return `"${litValue}"`;
        }
      }
      // Check for null
      if (litValue === null) {
        return 'null';
      }
    }

    // Check for undefined identifier
    if (arg.type === 'Identifier' && arg.name === 'undefined') {
      return 'undefined';
    }

    // Check for empty object literal {}
    if (arg.type === 'ObjectExpression' && arg.properties.length === 0) {
      return '{}';
    }

    // Check for empty array literal []
    if (arg.type === 'ArrayExpression' && arg.elements.length === 0) {
      return '[]';
    }

    return null;
  }

  /**
   * Check if function only has logging statements
   */
  private onlyHasLogging(statements: TSESTree.Statement[]): boolean {
    if (statements.length === 0) {
      return false;
    }

    for (const stmt of statements) {
      if (stmt.type !== 'ExpressionStatement') {
        return false;
      }

      const expr = stmt.expression;
      if (expr.type !== 'CallExpression') {
        return false;
      }

      const callee = expr.callee;

      // Check for console.log, console.warn, etc.
      if (callee.type === 'MemberExpression') {
        const obj = callee.object;
        if (obj.type === 'Identifier' && obj.name === 'console') {
          continue;
        }
      }

      // Check for print()
      if (callee.type === 'Identifier' && callee.name === 'print') {
        continue;
      }

      return false;
    }

    return true;
  }

  /**
   * Get function name from node
   */
  private getFunctionName(
    node: TSESTree.FunctionDeclaration | TSESTree.FunctionExpression | TSESTree.ArrowFunctionExpression
  ): string | null {
    if (node.type === 'FunctionDeclaration' && node.id) {
      return node.id.name;
    }
    if (node.type === 'FunctionExpression' && node.id) {
      return node.id.name;
    }
    return null;
  }

  /**
   * Get method name from MethodDefinition node
   */
  private getMethodName(node: TSESTree.MethodDefinition): string {
    const key = node.key;
    if (key.type === 'Identifier') {
      return key.name;
    }
    if (key.type === 'Literal') {
      return String(key.value);
    }
    return 'computed method';
  }

  /**
   * Traverse AST and call callback for each node
   */
  private traverseAST(
    node: TSESTree.Node,
    callback: (node: TSESTree.Node) => void
  ): void {
    callback(node);

    for (const key of Object.keys(node)) {
      const value = (node as unknown as Record<string, unknown>)[key];
      if (value && typeof value === 'object') {
        if (Array.isArray(value)) {
          for (const item of value) {
            if (item && typeof item === 'object' && 'type' in item) {
              this.traverseAST(item as TSESTree.Node, callback);
            }
          }
        } else if ('type' in value) {
          this.traverseAST(value as TSESTree.Node, callback);
        }
      }
    }
  }

  /**
   * Get severity level for a comment type
   */
  private getCommentSeverity(commentType: string): Severity {
    const upper = commentType.toUpperCase();
    if (upper === 'FIXME' || upper === 'XXX' || upper === 'HACK') {
      return 'error';
    }
    if (upper === 'TODO') {
      return 'warning';
    }
    return 'info';
  }

  /**
   * Fallback detection when AST parsing fails
   */
  private fallbackDetection(file: FileContent): Issue[] {
    const issues: Issue[] = [];

    // Simple regex patterns for stub detection
    const patterns = [
      {
        pattern: /function\s+\w+\s*\([^)]*\)\s*\{\s*\}/,
        message: 'Empty function detected',
        severity: 'warning' as Severity,
      },
      {
        pattern: /=>\s*\{\s*\}/,
        message: 'Empty arrow function detected',
        severity: 'warning' as Severity,
      },
      {
        pattern: /throw\s+new\s+Error\s*\(\s*['"`].*not\s*implemented.*['"`]\s*\)/i,
        message: 'Function throws "not implemented" error',
        severity: 'error' as Severity,
      },
      {
        pattern: /return\s+(null|undefined|\{\}|\[\]|-1|0|''|""|``)\s*;/,
        message: 'Function returns placeholder value',
        severity: 'warning' as Severity,
      },
    ];

    for (let i = 0; i < file.lines.length; i++) {
      const line = file.lines[i] ?? '';
      const lineNumber = i + 1;

      for (const { pattern, message, severity } of patterns) {
        if (pattern.test(line)) {
          issues.push(
            this.createIssue({
              severity,
              message,
              location: {
                file: file.path,
                line: lineNumber,
                column: 1,
              },
              context: this.extractContext(file.lines, lineNumber),
            })
          );
          break;
        }
      }
    }

    return issues;
  }
}
