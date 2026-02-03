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
 * Security vulnerability types
 */
type SecurityVulnerability =
  | 'hardcoded-secret'
  | 'sql-injection'
  | 'xss'
  | 'command-injection'
  | 'path-traversal'
  | 'insecure-random'
  | 'prototype-pollution'
  | 'regex-dos'
  | 'insecure-crypto';

/**
 * Pattern definition for security detection
 */
interface SecurityPattern {
  type: SecurityVulnerability;
  pattern: RegExp;
  severity: Severity;
  message: string;
  description: string;
  suggestion: string;
  /**
   * Whether to check in string literals only
   */
  inStrings?: boolean;
  /**
   * Context patterns that indicate false positive
   */
  falsePositivePatterns?: RegExp[];
}

/**
 * Patterns for detecting hardcoded secrets
 */
const SECRET_PATTERNS: SecurityPattern[] = [
  {
    type: 'hardcoded-secret',
    pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*['"`]([a-zA-Z0-9_\-]{20,})['"`]/i,
    severity: 'error',
    message: 'Potential hardcoded API key detected',
    description: 'Hardcoded API keys can be extracted from source code and misused.',
    suggestion: 'Use environment variables or a secrets manager',
  },
  {
    type: 'hardcoded-secret',
    pattern: /(?:secret|password|passwd|pwd)\s*[:=]\s*['"`]([^'"`]{8,})['"`]/i,
    severity: 'error',
    message: 'Potential hardcoded password or secret detected',
    description: 'Hardcoded credentials are a security risk.',
    suggestion: 'Use environment variables or a secrets manager',
    falsePositivePatterns: [
      /password\s*[:=]\s*['"`](?:\*+|x+|placeholder|changeme|example)['"`]/i,
    ],
  },
  {
    type: 'hardcoded-secret',
    pattern: /(?:aws[_-]?(?:access[_-]?key|secret))\s*[:=]\s*['"`]([A-Z0-9]{16,})['"`]/i,
    severity: 'error',
    message: 'Potential hardcoded AWS credential detected',
    description: 'AWS credentials should never be committed to source code.',
    suggestion: 'Use IAM roles, environment variables, or AWS Secrets Manager',
  },
  {
    type: 'hardcoded-secret',
    pattern: /(?:private[_-]?key|priv[_-]?key)\s*[:=]\s*['"`]-----BEGIN/i,
    severity: 'error',
    message: 'Private key detected in source code',
    description: 'Private keys should never be committed to source code.',
    suggestion: 'Store private keys securely outside of source control',
  },
  {
    type: 'hardcoded-secret',
    pattern: /(?:bearer|token)\s+[a-zA-Z0-9_\-\.]{20,}/i,
    severity: 'error',
    message: 'Potential hardcoded bearer token detected',
    description: 'Bearer tokens should not be hardcoded.',
    suggestion: 'Use environment variables or token management',
  },
  {
    type: 'hardcoded-secret',
    pattern: /ghp_[a-zA-Z0-9]{36}/,
    severity: 'error',
    message: 'GitHub personal access token detected',
    description: 'GitHub tokens should never be committed to source code.',
    suggestion: 'Use GitHub secrets or environment variables',
  },
  {
    type: 'hardcoded-secret',
    pattern: /sk-[a-zA-Z0-9]{48}/,
    severity: 'error',
    message: 'Potential OpenAI API key detected',
    description: 'API keys should never be committed to source code.',
    suggestion: 'Use environment variables',
  },
];

/**
 * Patterns for detecting injection vulnerabilities
 */
const INJECTION_PATTERNS: SecurityPattern[] = [
  {
    type: 'sql-injection',
    pattern: /(?:execute|query|exec)\s*\(\s*['"`](?:SELECT|INSERT|UPDATE|DELETE|DROP)[^'"`]*\$\{/i,
    severity: 'error',
    message: 'Potential SQL injection vulnerability',
    description: 'String interpolation in SQL queries can lead to SQL injection.',
    suggestion: 'Use parameterized queries or an ORM',
  },
  {
    type: 'sql-injection',
    pattern: /(?:execute|query|exec)\s*\(\s*[^)]*\+\s*(?:req|request|params|query|body|input)/i,
    severity: 'error',
    message: 'Potential SQL injection vulnerability',
    description: 'Concatenating user input into SQL queries is dangerous.',
    suggestion: 'Use parameterized queries or an ORM',
  },
  {
    type: 'command-injection',
    pattern: /(?:exec|spawn|execSync|spawnSync)\s*\(\s*(?:[^)]*\$\{|[^)]*\+\s*(?:req|request|params|query|body|input))/i,
    severity: 'error',
    message: 'Potential command injection vulnerability',
    description: 'Executing shell commands with user input can lead to command injection.',
    suggestion: 'Validate and sanitize input, use parameterized commands',
  },
  {
    type: 'command-injection',
    pattern: /child_process.*(?:exec|spawn).*\$\{/i,
    severity: 'error',
    message: 'Potential command injection vulnerability',
    description: 'Template literals in shell commands can lead to command injection.',
    suggestion: 'Use spawn with array arguments instead of exec with strings',
  },
  {
    type: 'path-traversal',
    pattern: /(?:readFile|writeFile|createReadStream|createWriteStream|unlink|rmdir)\s*\(\s*(?:[^)]*\$\{|[^)]*\+\s*(?:req|request|params|query|body|input))/i,
    severity: 'error',
    message: 'Potential path traversal vulnerability',
    description: 'Using unsanitized user input in file paths can lead to path traversal attacks.',
    suggestion: 'Validate and sanitize file paths, use path.resolve and check against allowed directories',
  },
  {
    type: 'path-traversal',
    pattern: /path\.join\s*\([^)]*(?:req|request|params|query|body|input)/i,
    severity: 'warning',
    message: 'User input used in file path construction',
    description: 'Ensure user input is validated before using in file paths.',
    suggestion: 'Validate that the resolved path is within allowed directories',
  },
];

/**
 * Patterns for detecting XSS vulnerabilities
 */
const XSS_PATTERNS: SecurityPattern[] = [
  {
    type: 'xss',
    pattern: /innerHTML\s*=\s*(?:[^;]*\$\{|[^;]*\+\s*(?:req|request|params|query|body|input))/i,
    severity: 'error',
    message: 'Potential XSS vulnerability via innerHTML',
    description: 'Setting innerHTML with user input can lead to XSS attacks.',
    suggestion: 'Use textContent or sanitize HTML with DOMPurify',
  },
  {
    type: 'xss',
    pattern: /document\.write\s*\(/i,
    severity: 'warning',
    message: 'document.write() usage detected',
    description: 'document.write() can be exploited for XSS attacks.',
    suggestion: 'Use DOM manipulation methods instead',
  },
  {
    type: 'xss',
    pattern: /dangerouslySetInnerHTML\s*=\s*\{\s*\{\s*__html\s*:\s*(?:[^}]*\$\{|[^}]*(?:req|request|params|query|body|input))/i,
    severity: 'error',
    message: 'Potential XSS vulnerability via dangerouslySetInnerHTML',
    description: 'Using dangerouslySetInnerHTML with user input can lead to XSS attacks.',
    suggestion: 'Sanitize HTML content with DOMPurify before rendering',
  },
  {
    type: 'xss',
    pattern: /eval\s*\(\s*(?:[^)]*\$\{|[^)]*(?:req|request|params|query|body|input))/i,
    severity: 'error',
    message: 'Potential XSS/code injection via eval()',
    description: 'Using eval() with user input is extremely dangerous.',
    suggestion: 'Never use eval() with user input. Use safer alternatives.',
  },
];

/**
 * Patterns for detecting other security issues
 */
const OTHER_SECURITY_PATTERNS: SecurityPattern[] = [
  {
    type: 'insecure-random',
    pattern: /Math\.random\s*\(\)/,
    severity: 'info',
    message: 'Math.random() is not cryptographically secure',
    description: 'Math.random() should not be used for security-sensitive operations.',
    suggestion: 'Use crypto.randomBytes() or crypto.getRandomValues() for security-sensitive randomness',
  },
  {
    type: 'insecure-crypto',
    pattern: /createHash\s*\(\s*['"`](?:md5|sha1)['"`]\s*\)/i,
    severity: 'warning',
    message: 'Weak hash algorithm detected',
    description: 'MD5 and SHA1 are considered cryptographically weak.',
    suggestion: 'Use SHA-256 or stronger hash algorithms',
  },
  {
    type: 'insecure-crypto',
    pattern: /createCipher\s*\(/i,
    severity: 'warning',
    message: 'Deprecated crypto.createCipher() usage',
    description: 'createCipher() is deprecated and uses weak key derivation.',
    suggestion: 'Use crypto.createCipheriv() with a proper IV',
  },
  {
    type: 'prototype-pollution',
    pattern: /\[(?:req|request|params|query|body|input)[^\]]*\]\s*=/i,
    severity: 'warning',
    message: 'Potential prototype pollution vulnerability',
    description: 'Using user-controlled keys for object property assignment can lead to prototype pollution.',
    suggestion: 'Validate object keys and use Object.hasOwn() checks',
  },
  {
    type: 'regex-dos',
    pattern: /new\s+RegExp\s*\(\s*(?:[^)]*\$\{|[^)]*(?:req|request|params|query|body|input))/i,
    severity: 'warning',
    message: 'Potential ReDoS vulnerability',
    description: 'Creating regular expressions from user input can lead to denial of service.',
    suggestion: 'Validate and sanitize regex input, or use a safe regex library',
  },
];

/**
 * All security patterns combined
 */
const ALL_PATTERNS: SecurityPattern[] = [
  ...SECRET_PATTERNS,
  ...INJECTION_PATTERNS,
  ...XSS_PATTERNS,
  ...OTHER_SECURITY_PATTERNS,
];

/**
 * Configuration for security analysis
 */
export interface SecurityAnalyzerConfig {
  /** Vulnerability types to check (default: all) */
  vulnerabilities?: SecurityVulnerability[];
  /** Custom patterns to add */
  customPatterns?: SecurityPattern[];
  /** Patterns to exclude */
  excludePatterns?: RegExp[];
}

/**
 * Analyzer for detecting security vulnerabilities
 */
export class SecurityAnalyzer extends BaseAnalyzer {
  readonly name = 'security-analyzer';
  readonly description = 'Detects security vulnerabilities and insecure patterns';
  readonly category = 'security' as const;

  async analyze(files: string[], options: AnalyzerOptions): Promise<Issue[]> {
    const issues: Issue[] = [];
    const config = this.getConfig(options);
    const patterns = this.getPatterns(config);
    const fileContents = await this.readFiles(files);

    for (const file of fileContents) {
      try {
        // Run regex-based detection
        const regexIssues = this.detectWithRegex(file, patterns, config);
        issues.push(...regexIssues);

        // Run AST-based detection for more accurate results
        const astIssues = await this.detectWithAST(file, config, options);
        issues.push(...astIssues);
      } catch (error) {
        this.logError(`Failed to analyze ${file.path}`, error);
      }
    }

    // Deduplicate issues (regex and AST might find the same issues)
    const uniqueIssues = this.deduplicateIssues(issues);

    this.log(options, `Found ${uniqueIssues.length} security issues in ${files.length} files`);

    return uniqueIssues;
  }

  /**
   * Get configuration from options
   */
  private getConfig(options: AnalyzerOptions): Required<SecurityAnalyzerConfig> {
    const userConfig = options.config as SecurityAnalyzerConfig | undefined;
    return {
      vulnerabilities: userConfig?.vulnerabilities ?? [],
      customPatterns: userConfig?.customPatterns ?? [],
      excludePatterns: userConfig?.excludePatterns ?? [],
    };
  }

  /**
   * Get patterns to use based on configuration
   */
  private getPatterns(config: Required<SecurityAnalyzerConfig>): SecurityPattern[] {
    let patterns = [...ALL_PATTERNS, ...config.customPatterns];

    // Filter by vulnerability types if specified
    if (config.vulnerabilities.length > 0) {
      const allowedTypes = new Set(config.vulnerabilities);
      patterns = patterns.filter((p) => allowedTypes.has(p.type));
    }

    return patterns;
  }

  /**
   * Detect security issues using regex patterns
   */
  private detectWithRegex(
    file: FileContent,
    patterns: SecurityPattern[],
    config: Required<SecurityAnalyzerConfig>
  ): Issue[] {
    const issues: Issue[] = [];

    for (let i = 0; i < file.lines.length; i++) {
      const line = file.lines[i] ?? '';
      const lineNumber = i + 1;

      // Skip comment-only lines
      if (this.isCommentLine(line)) {
        continue;
      }

      for (const pattern of patterns) {
        // Skip if line matches exclusion patterns
        if (config.excludePatterns.some((ep) => ep.test(line))) {
          continue;
        }

        // Check for false positives
        if (pattern.falsePositivePatterns?.some((fp) => fp.test(line))) {
          continue;
        }

        const match = line.match(pattern.pattern);
        if (match) {
          // Verify it's not in a comment
          const matchIndex = match.index ?? 0;
          if (this.isInComment(line, matchIndex)) {
            continue;
          }

          issues.push(
            this.createIssue({
              id: this.generateIssueId(
                this.category,
                file.path,
                lineNumber,
                pattern.type
              ),
              severity: pattern.severity,
              message: pattern.message,
              description: pattern.description,
              location: {
                file: file.path,
                line: lineNumber,
                column: matchIndex + 1,
              },
              context: this.extractContext(file.lines, lineNumber, 1),
              suggestion: pattern.suggestion,
              metadata: {
                vulnerabilityType: pattern.type,
                matchedPattern: pattern.pattern.source,
              },
            })
          );
        }
      }
    }

    return issues;
  }

  /**
   * Check if position is inside a comment
   */
  private isInComment(line: string, position: number): boolean {
    // Check for line comment before position
    const lineCommentIndex = line.indexOf('//');
    if (lineCommentIndex !== -1 && lineCommentIndex < position) {
      return true;
    }

    // Check for block comment (simple heuristic)
    const beforePosition = line.slice(0, position);
    const blockCommentStart = beforePosition.lastIndexOf('/*');
    const blockCommentEnd = beforePosition.lastIndexOf('*/');
    if (blockCommentStart !== -1 && blockCommentStart > blockCommentEnd) {
      return true;
    }

    return false;
  }

  /**
   * Detect security issues using AST analysis
   */
  private async detectWithAST(
    file: FileContent,
    config: Required<SecurityAnalyzerConfig>,
    options: AnalyzerOptions
  ): Promise<Issue[]> {
    const issues: Issue[] = [];

    try {
      const ast = parse(file.content, {
        loc: true,
        range: true,
        comment: true,
        jsx: file.path.endsWith('.tsx') || file.path.endsWith('.jsx'),
        errorOnUnknownASTType: false,
      });

      // Traverse AST for specific patterns
      this.traverseAST(ast, (node) => {
        // Check for eval() calls
        const evalIssue = this.checkEvalUsage(node, file);
        if (evalIssue) {
          issues.push(evalIssue);
        }

        // Check for dangerous function calls
        const dangerousIssue = this.checkDangerousFunctions(node, file);
        if (dangerousIssue) {
          issues.push(dangerousIssue);
        }

        // Check for insecure object property access
        const prototypeIssue = this.checkPrototypePollution(node, file);
        if (prototypeIssue) {
          issues.push(prototypeIssue);
        }
      });
    } catch (error) {
      this.log(options, `AST parsing failed for ${file.path}, using regex-only detection`);
    }

    return issues;
  }

  /**
   * Check for eval() usage
   */
  private checkEvalUsage(
    node: TSESTree.Node,
    file: FileContent
  ): Issue | null {
    if (
      node.type === 'CallExpression' &&
      node.callee.type === 'Identifier' &&
      node.callee.name === 'eval' &&
      node.loc
    ) {
      return this.createIssue({
        severity: 'error',
        message: 'eval() usage detected',
        description: 'eval() can execute arbitrary code and is a security risk.',
        location: {
          file: file.path,
          line: node.loc.start.line,
          column: node.loc.start.column + 1,
        },
        suggestion: 'Avoid eval(). Use safer alternatives like JSON.parse() for data.',
        metadata: {
          vulnerabilityType: 'xss',
        },
      });
    }

    return null;
  }

  /**
   * Check for dangerous function calls
   */
  private checkDangerousFunctions(
    node: TSESTree.Node,
    file: FileContent
  ): Issue | null {
    if (node.type !== 'CallExpression' || !node.loc) {
      return null;
    }

    // Check for Function constructor
    if (
      node.callee.type === 'Identifier' &&
      node.callee.name === 'Function'
    ) {
      return this.createIssue({
        severity: 'error',
        message: 'Function constructor usage detected',
        description: 'The Function constructor can execute arbitrary code like eval().',
        location: {
          file: file.path,
          line: node.loc.start.line,
          column: node.loc.start.column + 1,
        },
        suggestion: 'Avoid Function constructor. Use regular function declarations.',
        metadata: {
          vulnerabilityType: 'xss',
        },
      });
    }

    // Check for setTimeout/setInterval with string argument
    if (
      node.callee.type === 'Identifier' &&
      (node.callee.name === 'setTimeout' || node.callee.name === 'setInterval') &&
      node.arguments.length > 0 &&
      node.arguments[0]?.type === 'Literal' &&
      typeof (node.arguments[0] as TSESTree.Literal).value === 'string'
    ) {
      return this.createIssue({
        severity: 'warning',
        message: `${node.callee.name}() with string argument`,
        description: 'Passing a string to setTimeout/setInterval is evaluated like eval().',
        location: {
          file: file.path,
          line: node.loc.start.line,
          column: node.loc.start.column + 1,
        },
        suggestion: 'Pass a function reference instead of a string.',
        metadata: {
          vulnerabilityType: 'xss',
        },
      });
    }

    return null;
  }

  /**
   * Check for prototype pollution patterns
   */
  private checkPrototypePollution(
    node: TSESTree.Node,
    file: FileContent
  ): Issue | null {
    // Check for __proto__ or constructor.prototype access
    if (
      node.type === 'MemberExpression' &&
      node.property.type === 'Identifier' &&
      node.loc
    ) {
      const propName = node.property.name;

      if (propName === '__proto__') {
        return this.createIssue({
          severity: 'warning',
          message: '__proto__ property access detected',
          description: 'Direct __proto__ access can lead to prototype pollution.',
          location: {
            file: file.path,
            line: node.loc.start.line,
            column: node.loc.start.column + 1,
          },
          suggestion: 'Use Object.getPrototypeOf() or Object.setPrototypeOf() instead.',
          metadata: {
            vulnerabilityType: 'prototype-pollution',
          },
        });
      }
    }

    return null;
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
      const value = (node as Record<string, unknown>)[key];
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
   * Deduplicate issues found by both regex and AST analysis
   */
  private deduplicateIssues(issues: Issue[]): Issue[] {
    const seen = new Set<string>();
    const unique: Issue[] = [];

    for (const issue of issues) {
      const key = `${issue.location.file}:${issue.location.line}:${issue.message}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(issue);
      }
    }

    return unique;
  }
}
