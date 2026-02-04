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
        const fileIssues = this.analyzeFile(file, options);
        issues.push(...fileIssues);
      } catch (error) {
        this.logError(`Failed to analyze ${file.path}`, error);
      }
    }

    return issues;
  }

  private analyzeFile(
    file: FileContent,
    options: AnalyzerOptions
  ): Issue[] {
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
    } catch {
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
          const commentMatch = /\/\/.*|\/\*.*?\*\/|\/\*.*$/.exec(line);
          if (commentMatch) {
            const matchedText = match[0];
            const severity = this.getCommentSeverity(matchedText);
            issues.push(
              this.createIssue({
                id: this.generateIssueId(
                  this.category,
                  file.path,
                  lineNumber,
                  matchedText.toLowerCase()
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
    _options: AnalyzerOptions
  ): Issue[] {
    const issues: Issue[] = [];

    this.traverseAST(ast, (node) => {
      // Check function declarations
      const nodeType = node.type as string;
      if (
        nodeType === 'FunctionDeclaration' ||
        nodeType === 'FunctionExpression' ||
        nodeType === 'ArrowFunctionExpression'
      ) {
        const funcNode = node as TSESTree.FunctionDeclaration | TSESTree.FunctionExpression | TSESTree.ArrowFunctionExpression;
        const funcIssues = this.analyzeFunctionBody(funcNode, file);
        issues.push(...funcIssues);
      }

      // Check method definitions in classes
      if (nodeType === 'MethodDefinition') {
        const methodNode = node as TSESTree.MethodDefinition;
        if ((methodNode.value.type as string) === 'FunctionExpression') {
          const funcIssues = this.analyzeFunctionBody(methodNode.value as TSESTree.FunctionExpression, file, this.getMethodName(methodNode));
          issues.push(...funcIssues);
        }
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

    // node.loc is always defined after parsing with loc: true

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
    if (placeholderReturn !== null && placeholderReturn !== '') {
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
    const bodyType = body.type as string;
    if (bodyType === 'BlockStatement') {
      const blockBody = (body as TSESTree.BlockStatement).body;
      if (blockBody.length === 0) {
        return true;
      }
      // Check if only contains empty return or pass-like statements
      if (blockBody.length === 1) {
        const stmt = blockBody[0];
        const stmtType = stmt.type as string;
        if (stmtType === 'ReturnStatement' && !(stmt as TSESTree.ReturnStatement).argument) {
          return true;
        }
        if (stmtType === 'EmptyStatement') {
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
    const bodyType = body.type as string;
    if (bodyType === 'BlockStatement') {
      return (body as TSESTree.BlockStatement).body;
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
    const stmtType = stmt.type as string;
    if (stmtType !== 'ThrowStatement') {
      return false;
    }
    const throwStmt = stmt as TSESTree.ThrowStatement;
    const throwArg = throwStmt.argument;
    const throwArgType = throwArg.type as string;

    // Check for throw new Error('not implemented')
    if (throwArgType === 'NewExpression') {
      const newExpr = throwArg as TSESTree.NewExpression;
      const callee = newExpr.callee;
      const calleeType = callee.type as string;
      if (calleeType === 'Identifier') {
        const calleeId = callee as TSESTree.Identifier;
        if (calleeId.name === 'Error' || calleeId.name === 'NotImplementedError') {
          const args = newExpr.arguments;
          if (args.length > 0) {
            const arg = args[0];
            const argType = arg.type as string;
            if (argType === 'Literal' && typeof (arg as TSESTree.Literal).value === 'string') {
              return STUB_ERROR_PATTERNS.some((pattern) => pattern.test((arg as TSESTree.Literal).value as string));
            }
          }
          // throw new NotImplementedError() without message
          if (calleeId.name === 'NotImplementedError') {
            return true;
          }
        }
      }
    }

    // Check for throw 'not implemented'
    if (throwArgType === 'Literal' && typeof (throwArg as TSESTree.Literal).value === 'string') {
      return STUB_ERROR_PATTERNS.some((pattern) => pattern.test((throwArg as TSESTree.Literal).value as string));
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
    const stmtType = stmt.type as string;
    if (stmtType !== 'ReturnStatement') {
      return null;
    }
    const returnStmt = stmt as TSESTree.ReturnStatement;
    if (returnStmt.argument === null) {
      return null;
    }

    const arg = returnStmt.argument;
    const argType = arg.type as string;

    // Check literal values
    if (argType === 'Literal') {
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
    if (argType === 'Identifier' && (arg as TSESTree.Identifier).name === 'undefined') {
      return 'undefined';
    }

    // Check for empty object literal {}
    if (argType === 'ObjectExpression' && (arg as TSESTree.ObjectExpression).properties.length === 0) {
      return '{}';
    }

    // Check for empty array literal []
    if (argType === 'ArrayExpression' && (arg as TSESTree.ArrayExpression).elements.length === 0) {
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
      const stmtType = stmt.type as string;
      if (stmtType !== 'ExpressionStatement') {
        return false;
      }

      const expr = (stmt as TSESTree.ExpressionStatement).expression;
      const exprType = expr.type as string;
      if (exprType !== 'CallExpression') {
        return false;
      }

      const callee = (expr as TSESTree.CallExpression).callee;
      const calleeType = callee.type as string;

      // Check for console.log, console.warn, etc.
      if (calleeType === 'MemberExpression') {
        const obj = (callee as TSESTree.MemberExpression).object;
        const objType = obj.type as string;
        if (objType === 'Identifier' && (obj as TSESTree.Identifier).name === 'console') {
          continue;
        }
      }

      // Check for print()
      if (calleeType === 'Identifier' && (callee as TSESTree.Identifier).name === 'print') {
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
    const nodeType = node.type as string;
    if (nodeType === 'FunctionDeclaration') {
      const funcDecl = node as TSESTree.FunctionDeclaration;
      if (funcDecl.id !== null) {
        return funcDecl.id.name;
      }
    }
    if (nodeType === 'FunctionExpression') {
      const funcExpr = node as TSESTree.FunctionExpression;
      if (funcExpr.id !== null) {
        return funcExpr.id.name;
      }
    }
    return null;
  }

  /**
   * Get method name from MethodDefinition node
   */
  private getMethodName(node: TSESTree.MethodDefinition): string {
    const key = node.key;
    const keyType = key.type as string;
    if (keyType === 'Identifier') {
      return (key as TSESTree.Identifier).name;
    }
    if (keyType === 'Literal') {
      return String((key as TSESTree.Literal).value);
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
      if (value !== null && value !== undefined && typeof value === 'object') {
        if (Array.isArray(value)) {
          for (const item of value) {
            if (item !== null && item !== undefined && typeof item === 'object' && 'type' in item) {
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
