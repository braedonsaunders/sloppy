import * as ts from 'typescript';
import * as path from 'node:path';
import {
  BaseAnalyzer,
  type Issue,
  type AnalyzerOptions,
  type Severity,
} from '../base.js';

/**
 * Types of dead code to detect
 */
type DeadCodeType =
  | 'unused-export'
  | 'unused-function'
  | 'unused-variable'
  | 'unused-parameter'
  | 'unused-import'
  | 'unreachable-code'
  | 'unused-class'
  | 'unused-interface'
  | 'unused-type';

/**
 * Configuration for dead code analysis
 */
export interface DeadCodeAnalyzerConfig {
  /** Types of dead code to detect (default: all) */
  types?: DeadCodeType[];
  /** Ignore patterns for identifiers */
  ignorePatterns?: RegExp[];
  /** Whether to check exports usage across files (default: true) */
  checkExportsUsage?: boolean;
  /** Entry point files for export usage analysis */
  entryPoints?: string[];
}

/**
 * Information about a symbol in the codebase
 */
interface SymbolInfo {
  name: string;
  file: string;
  line: number;
  column: number;
  kind: DeadCodeType;
  isExported: boolean;
  usageCount: number;
}

/**
 * Analyzer for detecting dead code using TypeScript compiler API
 */
export class DeadCodeAnalyzer extends BaseAnalyzer {
  readonly name = 'dead-code-analyzer';
  readonly description = 'Detects unused code, unreachable code, and dead exports';
  readonly category = 'dead-code' as const;

  private readonly defaultTypes: DeadCodeType[] = [
    'unused-export',
    'unused-function',
    'unused-variable',
    'unused-parameter',
    'unused-import',
    'unreachable-code',
    'unused-class',
    'unused-interface',
    'unused-type',
  ];

  async analyze(files: string[], options: AnalyzerOptions): Promise<Issue[]> {
    const issues: Issue[] = [];
    const config = this.getConfig(options);

    // Filter to TypeScript/JavaScript files
    const sourceFiles = files.filter(
      (f) =>
        f.endsWith('.ts') ||
        f.endsWith('.tsx') ||
        f.endsWith('.js') ||
        f.endsWith('.jsx')
    );

    if (sourceFiles.length === 0) {
      this.log(options, 'No source files to analyze');
      return issues;
    }

    try {
      // Find tsconfig.json
      const tsconfigPath = this.findTsConfig(options.rootDir);

      // Create TypeScript program
      const program = this.createProgram(sourceFiles, tsconfigPath);
      const checker = program.getTypeChecker();

      // Collect all symbols
      const symbols = this.collectSymbols(program, checker, config, options);

      // Analyze symbol usage
      this.analyzeUsage(symbols, program, checker);

      // Generate issues for unused symbols
      const typesToCheck = new Set(config.types);

      for (const symbol of symbols.values()) {
        // Skip if type not in check list
        if (!typesToCheck.has(symbol.kind)) {
          continue;
        }

        // Skip if matches ignore patterns
        if (config.ignorePatterns.some((p) => p.test(symbol.name))) {
          continue;
        }

        // Skip if used
        if (symbol.usageCount > 0) {
          continue;
        }

        // Skip entry point exports if checking exports
        if (symbol.isExported && this.isEntryPoint(symbol.file, config, options)) {
          continue;
        }

        const issue = this.createIssueFromSymbol(symbol);
        issues.push(issue);
      }

      // Also check for unreachable code using diagnostics
      if (typesToCheck.has('unreachable-code')) {
        const unreachableIssues = this.findUnreachableCode(program, sourceFiles);
        issues.push(...unreachableIssues);
      }

      this.log(options, `Found ${issues.length} dead code issues in ${sourceFiles.length} files`);
    } catch (error) {
      this.logError('Failed to analyze dead code', error);
    }

    return issues;
  }

  /**
   * Get configuration from options
   */
  private getConfig(options: AnalyzerOptions): Required<DeadCodeAnalyzerConfig> {
    const userConfig = options.config as DeadCodeAnalyzerConfig | undefined;
    return {
      types: userConfig?.types ?? this.defaultTypes,
      ignorePatterns: userConfig?.ignorePatterns ?? [
        /^_/, // Variables starting with underscore
        /^React$/, // React import
        /^h$/, // Preact h function
      ],
      checkExportsUsage: userConfig?.checkExportsUsage ?? true,
      entryPoints: userConfig?.entryPoints ?? ['src/index.ts', 'src/index.tsx'],
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
    tsconfigPath: string | undefined
  ): ts.Program {
    let compilerOptions: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      noUnusedLocals: true,
      noUnusedParameters: true,
      allowJs: true,
      checkJs: true,
      skipLibCheck: true,
    };

    if (tsconfigPath) {
      const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
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
   * Check if a file is an entry point
   */
  private isEntryPoint(
    file: string,
    config: Required<DeadCodeAnalyzerConfig>,
    options: AnalyzerOptions
  ): boolean {
    const relativePath = path.relative(options.rootDir, file);
    return config.entryPoints.some(
      (ep) => relativePath === ep || file.endsWith(ep)
    );
  }

  /**
   * Collect all symbols from the program
   */
  private collectSymbols(
    program: ts.Program,
    checker: ts.TypeChecker,
    config: Required<DeadCodeAnalyzerConfig>,
    options: AnalyzerOptions
  ): Map<string, SymbolInfo> {
    const symbols = new Map<string, SymbolInfo>();
    const typesToCheck = new Set(config.types);

    for (const sourceFile of program.getSourceFiles()) {
      // Skip declaration files and node_modules
      if (sourceFile.isDeclarationFile) {
        continue;
      }
      if (sourceFile.fileName.includes('node_modules')) {
        continue;
      }

      const visit = (node: ts.Node): void => {
        // Function declarations
        if (
          typesToCheck.has('unused-function') &&
          ts.isFunctionDeclaration(node) &&
          node.name
        ) {
          const symbol = this.createSymbolInfo(
            node.name,
            sourceFile,
            'unused-function',
            this.isNodeExported(node)
          );
          symbols.set(symbol.name + ':' + symbol.file, symbol);
        }

        // Variable declarations
        if (typesToCheck.has('unused-variable') && ts.isVariableDeclaration(node)) {
          if (ts.isIdentifier(node.name)) {
            const symbol = this.createSymbolInfo(
              node.name,
              sourceFile,
              'unused-variable',
              this.isNodeExported(node.parent?.parent as ts.Node | undefined)
            );
            symbols.set(symbol.name + ':' + symbol.file, symbol);
          }
        }

        // Class declarations
        if (
          typesToCheck.has('unused-class') &&
          ts.isClassDeclaration(node) &&
          node.name
        ) {
          const symbol = this.createSymbolInfo(
            node.name,
            sourceFile,
            'unused-class',
            this.isNodeExported(node)
          );
          symbols.set(symbol.name + ':' + symbol.file, symbol);
        }

        // Interface declarations
        if (
          typesToCheck.has('unused-interface') &&
          ts.isInterfaceDeclaration(node)
        ) {
          const symbol = this.createSymbolInfo(
            node.name,
            sourceFile,
            'unused-interface',
            this.isNodeExported(node)
          );
          symbols.set(symbol.name + ':' + symbol.file, symbol);
        }

        // Type alias declarations
        if (
          typesToCheck.has('unused-type') &&
          ts.isTypeAliasDeclaration(node)
        ) {
          const symbol = this.createSymbolInfo(
            node.name,
            sourceFile,
            'unused-type',
            this.isNodeExported(node)
          );
          symbols.set(symbol.name + ':' + symbol.file, symbol);
        }

        // Import declarations
        if (typesToCheck.has('unused-import') && ts.isImportDeclaration(node)) {
          const importClause = node.importClause;
          if (importClause) {
            // Default import
            if (importClause.name) {
              const symbol = this.createSymbolInfo(
                importClause.name,
                sourceFile,
                'unused-import',
                false
              );
              symbols.set(symbol.name + ':' + symbol.file, symbol);
            }
            // Named imports
            if (
              importClause.namedBindings &&
              ts.isNamedImports(importClause.namedBindings)
            ) {
              for (const element of importClause.namedBindings.elements) {
                const symbol = this.createSymbolInfo(
                  element.name,
                  sourceFile,
                  'unused-import',
                  false
                );
                symbols.set(symbol.name + ':' + symbol.file, symbol);
              }
            }
          }
        }

        // Parameters
        if (
          typesToCheck.has('unused-parameter') &&
          ts.isParameter(node) &&
          ts.isIdentifier(node.name)
        ) {
          // Skip parameters in abstract methods or interface declarations
          const parent = node.parent;
          if (
            ts.isFunctionDeclaration(parent) ||
            ts.isMethodDeclaration(parent) ||
            ts.isArrowFunction(parent) ||
            ts.isFunctionExpression(parent)
          ) {
            const symbol = this.createSymbolInfo(
              node.name,
              sourceFile,
              'unused-parameter',
              false
            );
            symbols.set(
              symbol.name + ':' + symbol.file + ':' + symbol.line,
              symbol
            );
          }
        }

        ts.forEachChild(node, visit);
      };

      visit(sourceFile);
    }

    return symbols;
  }

  /**
   * Create symbol info from an identifier node
   */
  private createSymbolInfo(
    identifier: ts.Identifier,
    sourceFile: ts.SourceFile,
    kind: DeadCodeType,
    isExported: boolean
  ): SymbolInfo {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(
      identifier.getStart()
    );

    return {
      name: identifier.text,
      file: sourceFile.fileName,
      line: line + 1,
      column: character + 1,
      kind,
      isExported,
      usageCount: 0,
    };
  }

  /**
   * Check if a node is exported
   */
  private isNodeExported(node: ts.Node | undefined): boolean {
    if (!node) {
      return false;
    }

    // Check for export keyword
    if (
      ts.canHaveModifiers(node) &&
      ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      return true;
    }

    return false;
  }

  /**
   * Analyze usage of collected symbols
   */
  private analyzeUsage(
    symbols: Map<string, SymbolInfo>,
    program: ts.Program,
    checker: ts.TypeChecker
  ): void {
    // Create a map of symbol names to their info for quick lookup
    const nameToSymbols = new Map<string, SymbolInfo[]>();
    for (const symbol of symbols.values()) {
      const existing = nameToSymbols.get(symbol.name) ?? [];
      existing.push(symbol);
      nameToSymbols.set(symbol.name, existing);
    }

    // Scan all source files for identifier usage
    for (const sourceFile of program.getSourceFiles()) {
      if (sourceFile.isDeclarationFile) {
        continue;
      }
      if (sourceFile.fileName.includes('node_modules')) {
        continue;
      }

      const visit = (node: ts.Node): void => {
        if (ts.isIdentifier(node)) {
          const name = node.text;
          const symbolInfos = nameToSymbols.get(name);

          if (symbolInfos) {
            // Check if this is a usage (not the declaration itself)
            for (const symbolInfo of symbolInfos) {
              // Skip if it's the same position (the declaration)
              const { line } = sourceFile.getLineAndCharacterOfPosition(
                node.getStart()
              );
              if (
                sourceFile.fileName === symbolInfo.file &&
                line + 1 === symbolInfo.line
              ) {
                continue;
              }

              // Count as usage if in same file or if imported
              symbolInfo.usageCount++;
            }
          }
        }

        ts.forEachChild(node, visit);
      };

      visit(sourceFile);
    }
  }

  /**
   * Create an issue from a symbol info
   */
  private createIssueFromSymbol(symbol: SymbolInfo): Issue {
    const kindMessages: Record<DeadCodeType, string> = {
      'unused-export': `Exported '${symbol.name}' is never imported`,
      'unused-function': `Function '${symbol.name}' is declared but never used`,
      'unused-variable': `Variable '${symbol.name}' is declared but never used`,
      'unused-parameter': `Parameter '${symbol.name}' is declared but never used`,
      'unused-import': `Import '${symbol.name}' is unused`,
      'unreachable-code': 'Unreachable code detected',
      'unused-class': `Class '${symbol.name}' is declared but never used`,
      'unused-interface': `Interface '${symbol.name}' is declared but never used`,
      'unused-type': `Type '${symbol.name}' is declared but never used`,
    };

    const severity = this.getSeverity(symbol.kind);

    return this.createIssue({
      severity,
      message: kindMessages[symbol.kind],
      description: 'Dead code should be removed to improve maintainability.',
      location: {
        file: symbol.file,
        line: symbol.line,
        column: symbol.column,
      },
      suggestion: this.getSuggestion(symbol.kind, symbol.name),
      metadata: {
        deadCodeType: symbol.kind,
        isExported: symbol.isExported,
      },
    });
  }

  /**
   * Get severity for dead code type
   */
  private getSeverity(kind: DeadCodeType): Severity {
    switch (kind) {
      case 'unreachable-code':
        return 'error';
      case 'unused-import':
      case 'unused-variable':
        return 'warning';
      default:
        return 'info';
    }
  }

  /**
   * Get suggestion for dead code type
   */
  private getSuggestion(kind: DeadCodeType, name: string): string {
    switch (kind) {
      case 'unused-import':
        return `Remove the unused import '${name}'`;
      case 'unused-variable':
        return `Remove the unused variable '${name}' or prefix with underscore if intentional`;
      case 'unused-parameter':
        return `Remove the parameter '${name}' or prefix with underscore if required for signature`;
      case 'unused-function':
        return `Remove the unused function '${name}' or export if intended for external use`;
      case 'unused-export':
        return `Remove the export or the entire declaration if not used elsewhere`;
      case 'unreachable-code':
        return 'Remove the unreachable code';
      default:
        return `Remove the unused ${kind.replace('unused-', '')} '${name}'`;
    }
  }

  /**
   * Find unreachable code using TypeScript diagnostics
   */
  private findUnreachableCode(
    program: ts.Program,
    files: string[]
  ): Issue[] {
    const issues: Issue[] = [];

    for (const file of files) {
      const sourceFile = program.getSourceFile(file);
      if (!sourceFile) {
        continue;
      }

      // Check for unreachable code after return/throw/break/continue
      const visit = (node: ts.Node): void => {
        if (ts.isBlock(node)) {
          let foundTerminator = false;

          for (const stmt of node.statements) {
            if (foundTerminator) {
              const { line, character } = sourceFile.getLineAndCharacterOfPosition(
                stmt.getStart()
              );

              issues.push(
                this.createIssue({
                  severity: 'error',
                  message: 'Unreachable code detected',
                  description:
                    'This code will never execute because it follows a return, throw, break, or continue statement.',
                  location: {
                    file: sourceFile.fileName,
                    line: line + 1,
                    column: character + 1,
                  },
                  suggestion: 'Remove the unreachable code or restructure the logic',
                  metadata: {
                    deadCodeType: 'unreachable-code',
                  },
                })
              );
              break; // Only report the first unreachable statement in each block
            }

            if (
              ts.isReturnStatement(stmt) ||
              ts.isThrowStatement(stmt) ||
              ts.isBreakStatement(stmt) ||
              ts.isContinueStatement(stmt)
            ) {
              foundTerminator = true;
            }
          }
        }

        ts.forEachChild(node, visit);
      };

      visit(sourceFile);
    }

    return issues;
  }
}
