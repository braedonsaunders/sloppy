import * as ts from 'typescript';
import * as path from 'node:path';
import {
  BaseAnalyzer,
  type Issue,
  type AnalyzerOptions,
} from '../base.js';

/**
 * Type patterns to detect
 */
type TypePattern =
  | 'any-usage'
  | 'missing-return-type'
  | 'implicit-any'
  | 'type-assertion-abuse'
  | 'non-null-assertion'
  | 'unsafe-member-access'
  | 'missing-generic-type';

/**
 * Configuration for type analysis
 */
export interface TypeAnalyzerConfig {
  /** Patterns to check (default: all) */
  patterns?: TypePattern[];
  /** Allow any in certain contexts */
  allowAnyInCatchClause?: boolean;
  /** Allow any in test files */
  allowAnyInTests?: boolean;
}

/**
 * Analyzer for detecting TypeScript type issues
 */
export class TypeAnalyzer extends BaseAnalyzer {
  readonly name = 'type-analyzer';
  readonly description = 'Detects TypeScript type issues and unsafe type usage';
  readonly category = 'type' as const;

  private readonly defaultPatterns: TypePattern[] = [
    'any-usage',
    'missing-return-type',
    'implicit-any',
    'type-assertion-abuse',
    'non-null-assertion',
    'unsafe-member-access',
    'missing-generic-type',
  ];

  analyze(files: string[], options: AnalyzerOptions): Promise<Issue[]> {
    const issues: Issue[] = [];
    const config = this.getConfig(options);

    // Filter to only TypeScript files
    const tsFiles = files.filter(
      (f) => f.endsWith('.ts') || f.endsWith('.tsx')
    );

    if (tsFiles.length === 0) {
      this.log(options, 'No TypeScript files to analyze');
      return Promise.resolve(issues);
    }

    try {
      // Find tsconfig.json
      const tsconfigPath = this.findTsConfig(options.rootDir);

      // Create TypeScript program with strict mode
      const program = this.createStrictProgram(tsFiles, tsconfigPath);
      const checker = program.getTypeChecker();

      // Analyze each source file
      for (const file of tsFiles) {
        const sourceFile = program.getSourceFile(file);
        if (!sourceFile) {
          continue;
        }

        // Skip test files if configured
        if (config.allowAnyInTests && this.isTestFile(file)) {
          continue;
        }

        try {
          const fileIssues = this.analyzeSourceFile(
            sourceFile,
            checker,
            program,
            config
          );
          issues.push(...fileIssues);
        } catch (error) {
          this.logError(`Failed to analyze ${file}`, error);
        }
      }

      this.log(options, `Analyzed ${String(tsFiles.length)} TypeScript files, found ${String(issues.length)} type issues`);
    } catch (error) {
      this.logError('Failed to create TypeScript program', error);
    }

    return Promise.resolve(issues);
  }

  /**
   * Get configuration from options
   */
  private getConfig(options: AnalyzerOptions): Required<TypeAnalyzerConfig> {
    const userConfig = options.config as TypeAnalyzerConfig | undefined;
    return {
      patterns: userConfig?.patterns ?? this.defaultPatterns,
      allowAnyInCatchClause: userConfig?.allowAnyInCatchClause ?? true,
      allowAnyInTests: userConfig?.allowAnyInTests ?? false,
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
   * Create TypeScript program with strict settings
   */
  private createStrictProgram(
    files: string[],
    tsconfigPath: string | undefined
  ): ts.Program {
    let compilerOptions: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      strict: true,
      strictNullChecks: true,
      noImplicitAny: true,
      noImplicitReturns: true,
      noImplicitThis: true,
      strictFunctionTypes: true,
      strictPropertyInitialization: true,
      strictBindCallApply: true,
      useUnknownInCatchVariables: true,
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
        // Merge but keep strict options
        compilerOptions = { ...parsed.options, ...compilerOptions };
      }
    }

    return ts.createProgram(files, compilerOptions);
  }

  /**
   * Check if a file is a test file
   */
  private isTestFile(file: string): boolean {
    return (
      file.includes('.test.') ||
      file.includes('.spec.') ||
      file.includes('__tests__') ||
      file.includes('/test/')
    );
  }

  /**
   * Analyze a single source file
   */
  private analyzeSourceFile(
    sourceFile: ts.SourceFile,
    checker: ts.TypeChecker,
    _program: ts.Program,
    config: Required<TypeAnalyzerConfig>
  ): Issue[] {
    const issues: Issue[] = [];
    const patterns = new Set(config.patterns);

    const visit = (node: ts.Node): void => {
      // Check for explicit 'any' type usage
      if (patterns.has('any-usage')) {
        const anyIssue = this.checkAnyUsage(node, sourceFile, config);
        if (anyIssue) {
          issues.push(anyIssue);
        }
      }

      // Check for missing return types on functions
      if (patterns.has('missing-return-type')) {
        const returnIssue = this.checkMissingReturnType(node, sourceFile);
        if (returnIssue) {
          issues.push(returnIssue);
        }
      }

      // Check for type assertion abuse
      if (patterns.has('type-assertion-abuse')) {
        const assertIssue = this.checkTypeAssertionAbuse(node, sourceFile);
        if (assertIssue) {
          issues.push(assertIssue);
        }
      }

      // Check for non-null assertion abuse
      if (patterns.has('non-null-assertion')) {
        const nonNullIssue = this.checkNonNullAssertion(node, sourceFile);
        if (nonNullIssue) {
          issues.push(nonNullIssue);
        }
      }

      // Check for implicit any
      if (patterns.has('implicit-any')) {
        const implicitIssue = this.checkImplicitAny(node, checker, sourceFile);
        if (implicitIssue) {
          issues.push(implicitIssue);
        }
      }

      // Check for missing generic types
      if (patterns.has('missing-generic-type')) {
        const genericIssue = this.checkMissingGenericType(node, sourceFile);
        if (genericIssue) {
          issues.push(genericIssue);
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    return issues;
  }

  /**
   * Check for explicit 'any' type usage
   */
  private checkAnyUsage(
    node: ts.Node,
    sourceFile: ts.SourceFile,
    config: Required<TypeAnalyzerConfig>
  ): Issue | null {
    // Check type references
    if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
      if (node.typeName.text === 'any') {
        return this.createAnyIssue(node, sourceFile, 'Explicit any type reference');
      }
    }

    // Check keyword any
    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      // Skip if in catch clause and allowed
      if (config.allowAnyInCatchClause && this.isInCatchClause(node)) {
        return null;
      }

      return this.createAnyIssue(node, sourceFile, 'any type usage');
    }

    return null;
  }

  /**
   * Check if node is inside a catch clause
   */
  private isInCatchClause(node: ts.Node): boolean {
    let currentNode: ts.Node | undefined = node;
    while (currentNode !== undefined) {
      if (ts.isCatchClause(currentNode)) {
        return true;
      }
      currentNode = currentNode.parent as ts.Node | undefined;
    }
    return false;
  }

  /**
   * Create an issue for any usage
   */
  private createAnyIssue(
    node: ts.Node,
    sourceFile: ts.SourceFile,
    message: string
  ): Issue {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(
      node.getStart()
    );

    return this.createIssue({
      severity: 'warning',
      message,
      description: 'Using "any" type bypasses TypeScript type checking and can hide bugs.',
      location: {
        file: sourceFile.fileName,
        line: line + 1,
        column: character + 1,
      },
      suggestion: 'Use a more specific type, "unknown", or define an interface',
    });
  }

  /**
   * Check for missing return types on functions
   */
  private checkMissingReturnType(
    node: ts.Node,
    sourceFile: ts.SourceFile
  ): Issue | null {
    // Check function declarations
    if (ts.isFunctionDeclaration(node)) {
      if (!node.type && node.name) {
        return this.createMissingReturnTypeIssue(
          node,
          sourceFile,
          node.name.text
        );
      }
    }

    // Check method declarations
    if (ts.isMethodDeclaration(node)) {
      if (!node.type && ts.isIdentifier(node.name)) {
        return this.createMissingReturnTypeIssue(
          node,
          sourceFile,
          node.name.text
        );
      }
    }

    // Check arrow functions in variable declarations
    if (ts.isVariableDeclaration(node)) {
      if (
        node.initializer &&
        ts.isArrowFunction(node.initializer) &&
        !node.type &&
        ts.isIdentifier(node.name)
      ) {
        // Only flag if it's not a simple expression
        if (ts.isBlock(node.initializer.body)) {
          return this.createMissingReturnTypeIssue(
            node,
            sourceFile,
            node.name.text
          );
        }
      }
    }

    return null;
  }

  /**
   * Create an issue for missing return type
   */
  private createMissingReturnTypeIssue(
    node: ts.Node,
    sourceFile: ts.SourceFile,
    funcName: string
  ): Issue {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(
      node.getStart()
    );

    return this.createIssue({
      severity: 'info',
      message: `Missing return type annotation on function '${funcName}'`,
      description: 'Explicit return types improve code clarity and catch type errors earlier.',
      location: {
        file: sourceFile.fileName,
        line: line + 1,
        column: character + 1,
      },
      suggestion: 'Add an explicit return type annotation',
    });
  }

  /**
   * Check for type assertion abuse (as any, as unknown)
   */
  private checkTypeAssertionAbuse(
    node: ts.Node,
    sourceFile: ts.SourceFile
  ): Issue | null {
    if (!ts.isAsExpression(node)) {
      return null;
    }

    const typeNode = node.type;

    // Check for "as any"
    if (typeNode.kind === ts.SyntaxKind.AnyKeyword) {
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(
        node.getStart()
      );

      return this.createIssue({
        severity: 'warning',
        message: 'Type assertion to "any" bypasses type checking',
        description: 'Casting to "any" removes all type safety and should be avoided.',
        location: {
          file: sourceFile.fileName,
          line: line + 1,
          column: character + 1,
        },
        suggestion: 'Use a more specific type or "unknown" with proper type guards',
      });
    }

    // Check for "as unknown" followed by "as SomeType" (double assertion)
    if (typeNode.kind === ts.SyntaxKind.UnknownKeyword) {
      // Check if parent is also an as expression
      const parent = node.parent;
      if (ts.isAsExpression(parent)) {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(
          parent.getStart()
        );

        return this.createIssue({
          severity: 'warning',
          message: 'Double type assertion (as unknown as T) indicates potential type safety issue',
          description: 'This pattern is often used to force incompatible type conversions.',
          location: {
            file: sourceFile.fileName,
            line: line + 1,
            column: character + 1,
          },
          suggestion: 'Consider if the types should actually be compatible or use type guards',
        });
      }
    }

    return null;
  }

  /**
   * Check for non-null assertion abuse
   */
  private checkNonNullAssertion(
    node: ts.Node,
    sourceFile: ts.SourceFile
  ): Issue | null {
    if (!ts.isNonNullExpression(node)) {
      return null;
    }

    const { line, character } = sourceFile.getLineAndCharacterOfPosition(
      node.getStart()
    );

    return this.createIssue({
      severity: 'info',
      message: 'Non-null assertion (!) used',
      description: 'Non-null assertions bypass null checking and can lead to runtime errors.',
      location: {
        file: sourceFile.fileName,
        line: line + 1,
        column: character + 1,
      },
      suggestion: 'Use optional chaining (?.) or add a proper null check',
    });
  }

  /**
   * Check for implicit any in parameters
   */
  private checkImplicitAny(
    node: ts.Node,
    checker: ts.TypeChecker,
    sourceFile: ts.SourceFile
  ): Issue | null {
    // Check function parameters without type annotations
    if (ts.isParameter(node) && !node.type) {
      // Skip if parent function has explicit this type
      if (ts.isIdentifier(node.name)) {
        const paramName = node.name.text;

        // Skip 'this' parameter
        if (paramName === 'this') {
          return null;
        }

        try {
          const type = checker.getTypeAtLocation(node);
          const typeStr = checker.typeToString(type);

          // Check if type is implicitly any
          if (typeStr === 'any' || type.flags & ts.TypeFlags.Any) {
            const { line, character } = sourceFile.getLineAndCharacterOfPosition(
              node.getStart()
            );

            return this.createIssue({
              severity: 'warning',
              message: `Parameter '${paramName}' has implicit 'any' type`,
              description: 'Parameters without type annotations default to "any".',
              location: {
                file: sourceFile.fileName,
                line: line + 1,
                column: character + 1,
              },
              suggestion: 'Add an explicit type annotation to the parameter',
            });
          }
        } catch {
          // Type inference failed, skip
        }
      }
    }

    return null;
  }

  /**
   * Check for missing generic type arguments
   */
  private checkMissingGenericType(
    node: ts.Node,
    sourceFile: ts.SourceFile
  ): Issue | null {
    // Check for common generics without type arguments
    if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
      const typeName = node.typeName.text;

      // List of generic types that should always have type arguments
      const genericTypes = [
        'Array',
        'Map',
        'Set',
        'WeakMap',
        'WeakSet',
        'Promise',
        'Record',
        'Partial',
        'Required',
        'Readonly',
        'Pick',
        'Omit',
      ];

      if (genericTypes.includes(typeName) && !node.typeArguments) {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(
          node.getStart()
        );

        return this.createIssue({
          severity: 'info',
          message: `Generic type '${typeName}' used without type arguments`,
          description: `The type '${typeName}' is generic and should have explicit type arguments.`,
          location: {
            file: sourceFile.fileName,
            line: line + 1,
            column: character + 1,
          },
          suggestion: `Add type arguments: ${typeName}<SomeType>`,
        });
      }
    }

    return null;
  }
}
