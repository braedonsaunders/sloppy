/**
 * Layer 0: Local static analysis — zero API calls.
 *
 * Catches issues that don't need AI: hardcoded secrets, stubs, dangerous
 * function calls, SQL injection patterns, empty catches, etc. These are
 * reported directly and excluded from AI scanning to save token budget.
 */

import * as core from '@actions/core';
import * as fs from 'fs';
import * as path from 'path';
import { Issue, IssueType, Severity, PluginPattern } from './types';

interface Pattern {
  regex: RegExp;
  type: IssueType;
  severity: Severity;
  description: string;
  /** Only match in files with these extensions (empty = all). */
  extensions?: string[];
}

const PATTERNS: Pattern[] = [
  // ── Security: hardcoded secrets ──────────────────────────────────
  {
    regex: /(?:password|passwd|secret|api_key|apikey|auth_token)\s*[=:]\s*['"][^'"]{8,}['"]/gi,
    type: 'security',
    severity: 'critical',
    description: 'Hardcoded secret or password',
  },
  {
    regex: /['"](?:sk[-_]|pk[-_]|key[-_]|ghp_|gho_|ghs_|github_pat_|glpat-|xox[bpsar]-|AKIA)[A-Za-z0-9_\-]{16,}['"]/g,
    type: 'security',
    severity: 'critical',
    description: 'Hardcoded API key or token',
  },
  // ── Security: dangerous functions ────────────────────────────────
  {
    regex: /\beval\s*\([^)]*(?:req|request|input|user|data|param|query|body)/gi,
    type: 'security',
    severity: 'critical',
    description: 'eval() called on user-controlled input',
  },
  {
    regex: /\bexec\s*\([^)]*(?:req|request|input|user|data|param|query|body)/gi,
    type: 'security',
    severity: 'critical',
    description: 'exec() called on user-controlled input',
    extensions: ['.py'],
  },
  {
    regex: /\bdangerouslySetInnerHTML\b/g,
    type: 'security',
    severity: 'high',
    description: 'dangerouslySetInnerHTML usage — verify input is sanitized',
    extensions: ['.tsx', '.jsx', '.js', '.ts'],
  },
  {
    regex: /\bos\.system\s*\(/g,
    type: 'security',
    severity: 'high',
    description: 'os.system() is vulnerable to shell injection — use subprocess with shell=False',
    extensions: ['.py'],
  },
  // ── Security: SQL injection ──────────────────────────────────────
  {
    regex: /f["'](?:[^"']*?)(?:SELECT|INSERT|UPDATE|DELETE|DROP)\b[^"']*?\{/gi,
    type: 'security',
    severity: 'critical',
    description: 'Possible SQL injection via f-string interpolation',
    extensions: ['.py'],
  },
  {
    regex: /`[^`]*(?:SELECT|INSERT|UPDATE|DELETE|DROP)\b[^`]*\$\{/gi,
    type: 'security',
    severity: 'critical',
    description: 'Possible SQL injection via template literal interpolation',
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
  },
  {
    regex: /["']\s*\+\s*\w+\s*\+\s*["'].*(?:SELECT|INSERT|UPDATE|DELETE|DROP)/gi,
    type: 'security',
    severity: 'high',
    description: 'Possible SQL injection via string concatenation',
  },
  // ── Stubs ────────────────────────────────────────────────────────
  {
    regex: /\b(?:TODO|FIXME|HACK|XXX)\b[:\s]*.{0,80}/g,
    type: 'stubs',
    severity: 'medium',
    description: 'TODO/FIXME marker',
  },
  {
    regex: /raise\s+NotImplementedError/g,
    type: 'stubs',
    severity: 'medium',
    description: 'NotImplementedError — stub implementation',
    extensions: ['.py'],
  },
  {
    regex: /throw\s+new\s+Error\s*\(\s*['"]not\s+implemented/gi,
    type: 'stubs',
    severity: 'medium',
    description: 'Stub: throws "not implemented"',
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
  },
  // ── Bugs: empty error handling ───────────────────────────────────
  {
    regex: /except\s*(?:(?:Exception|BaseException)(?:\s+as\s+\w+)?\s*)?:\s*(?:pass|\.\.\.)\s*$/gm,
    type: 'bugs',
    severity: 'high',
    description: 'Empty except clause silently swallows errors',
    extensions: ['.py'],
  },
  {
    regex: /catch\s*\([^)]*\)\s*\{\s*\}/g,
    type: 'bugs',
    severity: 'high',
    description: 'Empty catch block silently swallows errors',
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.java', '.kt'],
  },
  // ── Lint: debugging leftovers ──────────────────────────────────
  {
    regex: /\bconsole\.log\s*\(/g,
    type: 'lint',
    severity: 'low',
    description: 'console.log() left in code',
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
  },
  {
    regex: /\bdebugger\b/g,
    type: 'lint',
    severity: 'medium',
    description: 'debugger statement left in code',
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
  },
  // ── Types: explicit `any` usage ────────────────────────────────
  {
    regex: /:\s*any\b/g,
    type: 'types',
    severity: 'medium',
    description: 'Explicit `any` type — consider using a specific type',
    extensions: ['.ts', '.tsx'],
  },
  {
    regex: /\bas\s+any\b/g,
    type: 'types',
    severity: 'medium',
    description: 'Unsafe cast to `any` — consider using a specific type',
    extensions: ['.ts', '.tsx'],
  },
];

/**
 * Basic check for common ReDoS patterns (nested quantifiers).
 * Detects patterns like (a+)+, (a*)+, (a+)*, (a{2,})+ which cause
 * catastrophic backtracking.
 */
function isReDoSRisk(pattern: string): boolean {
  return /([+*?]|\{\d+,?\d*\})\s*\)\s*([+*?]|\{\d+,?\d*\})/.test(pattern);
}

/** Convert PluginPattern definitions into runtime Pattern objects. */
function compilePluginPatterns(pluginPatterns: PluginPattern[]): Pattern[] {
  const compiled: Pattern[] = [];
  for (const pp of pluginPatterns) {
    try {
      if (isReDoSRisk(pp.regex)) {
        core.warning(`Plugin pattern rejected (potential ReDoS): ${pp.regex.slice(0, 60)}`);
        continue;
      }
      if (pp.regex.length > 500) {
        core.warning(`Plugin pattern rejected (too complex, ${pp.regex.length} chars): ${pp.regex.slice(0, 60)}...`);
        continue;
      }
      const regex = new RegExp(pp.regex, 'g');
      compiled.push({
        regex,
        type: pp.type as IssueType,
        severity: pp.severity,
        description: pp.description,
        extensions: pp.extensions,
      });
    } catch (e) {
      // Skip invalid regex patterns from plugins
    }
  }
  return compiled;
}

// ---------------------------------------------------------------------------
// Deterministic detectors — zero false-positive structural analysis
// ---------------------------------------------------------------------------

/**
 * Detect TypeScript/JavaScript functions missing explicit return type annotations.
 * Handles function declarations, arrow functions assigned to const, and
 * multi-line parameter lists. Skips constructors, .d.ts files, and functions
 * where the const variable itself carries a type annotation.
 */
function detectMissingReturnTypesTS(content: string, relativePath: string): Issue[] {
  // Skip declaration files — they are pure types
  if (relativePath.endsWith('.d.ts')) return [];

  const lines = content.split('\n');
  const issues: Issue[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();

    // Skip comments
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;

    let funcName: string | null = null;
    let isArrow = false;

    // --- function declarations: export? default? async? function name<T>( ---
    const fnMatch = trimmed.match(
      /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+(\w+)\s*(?:<[^>]*>)?\s*\(/,
    );
    if (fnMatch) {
      funcName = fnMatch[1];
    }

    // --- arrow / const declarations: export? const name = async? ( ---
    // Skip if the const has a type annotation (const name: SomeType = ...)
    if (!funcName) {
      const constMatch = trimmed.match(
        /^(?:export\s+)?const\s+(\w+)\s*(:\s*[^=]+?)?\s*=\s*(?:async\s*)?\(/,
      );
      if (constMatch) {
        // If the variable itself carries a full type annotation, the return type
        // is already specified (e.g. `const fn: () => void = () => { ... }`)
        if (constMatch[2] && constMatch[2].trim().length > 1) continue;
        funcName = constMatch[1];
        isArrow = true;
      }
    }

    if (!funcName) continue;

    // Skip constructors
    if (funcName === 'constructor') continue;

    // Walk forward to find the closing paren (handles multi-line params)
    let parenDepth = 0;
    let foundClose = false;
    let closeLine = i;

    for (let j = i; j < Math.min(i + 30, lines.length); j++) {
      for (const ch of lines[j]) {
        if (ch === '(') parenDepth++;
        if (ch === ')') {
          parenDepth--;
          if (parenDepth === 0) {
            foundClose = true;
            closeLine = j;
            break;
          }
        }
      }
      if (foundClose) break;
    }

    if (!foundClose) continue;

    // Gather text after the closing paren (same line + next few lines)
    const closeContent = lines[closeLine];
    const closeIdx = closeContent.lastIndexOf(')');
    let afterParen = closeContent.slice(closeIdx + 1);
    for (let j = closeLine + 1; j < Math.min(closeLine + 3, lines.length); j++) {
      afterParen += ' ' + lines[j].trim();
    }

    // For arrow functions, verify `=>` actually exists after the closing paren.
    // This prevents matching parenthesized expressions like:
    //   const section = (e as CustomEvent).detail as AISection
    // where the `(` is a type-cast grouping, not function parameters.
    if (isArrow && !afterParen.includes('=>')) continue;

    // A return type annotation starts with `:` after the closing paren.
    // For arrow functions, also check for `=>` — if `:` comes before `=>` it's a return type.
    const hasReturnType = isArrow
      ? /^\s*:\s*\S/.test(afterParen) && afterParen.indexOf(':') < afterParen.indexOf('=>')
      : /^\s*:/.test(afterParen);

    if (!hasReturnType) {
      issues.push({
        id: `local-return-${Date.now()}-${issues.length}`,
        type: 'types',
        severity: 'medium',
        file: relativePath,
        line: i + 1,
        description: `Function '${funcName}' is missing an explicit return type annotation`,
        status: 'found',
        source: 'local',
      });
    }
  }

  return issues;
}

/**
 * Detect unused named imports within a single file.
 * Only flags imports where the identifier appears exactly once in the file (the import itself).
 * Conservative: skips React (implicit JSX usage), re-exports, and namespace imports.
 */
function detectUnusedImports(content: string, relativePath: string, ext: string): Issue[] {
  if (!['.ts', '.tsx', '.js', '.jsx'].includes(ext)) return [];

  const issues: Issue[] = [];

  // Named imports: import { Foo, Bar as Baz } from '...'
  const namedRe = /^import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['"][^'"]+['"]/gm;
  let m: RegExpExecArray | null;

  while ((m = namedRe.exec(content)) !== null) {
    const importLine = content.slice(0, m.index).split('\n').length;
    const names = m[1]
      .split(',')
      .map(n => {
        const parts = n.trim().split(/\s+as\s+/);
        return (parts[1] || parts[0]).trim();
      })
      .filter(Boolean);

    for (const name of names) {
      if (!name || name.length < 2) continue;
      // Count occurrences of the identifier in the whole file
      const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
      const count = (content.match(re) || []).length;
      if (count <= 1) {
        issues.push({
          id: `local-import-${Date.now()}-${issues.length}`,
          type: 'lint',
          severity: 'low',
          file: relativePath,
          line: importLine,
          description: `Unused import: '${name}'`,
          status: 'found',
          source: 'local',
        });
      }
    }
  }

  // Default imports: import Foo from '...'
  const defaultRe = /^import\s+(\w+)\s+from\s+['"][^'"]+['"]/gm;
  while ((m = defaultRe.exec(content)) !== null) {
    const importLine = content.slice(0, m.index).split('\n').length;
    const name = m[1];
    // React is used implicitly in JSX
    if (name === 'React') continue;
    const re = new RegExp(`\\b${name}\\b`, 'g');
    const count = (content.match(re) || []).length;
    if (count <= 1) {
      issues.push({
        id: `local-import-${Date.now()}-${issues.length}`,
        type: 'lint',
        severity: 'low',
        file: relativePath,
        line: importLine,
        description: `Unused import: '${name}'`,
        status: 'found',
        source: 'local',
      });
    }
  }

  return issues;
}

/**
 * Run local static analysis on a single file.
 * Returns issues found without any API calls.
 * Accepts optional extra patterns contributed by plugins.
 */
export function localScanFile(filePath: string, cwd: string, extraPatterns: PluginPattern[] = []): Issue[] {
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return [];
  }

  const relativePath = path.relative(cwd, filePath);
  const ext = path.extname(filePath).toLowerCase();
  const lines = content.split('\n');
  const issues: Issue[] = [];

  const allPatterns = [...PATTERNS, ...compilePluginPatterns(extraPatterns)];

  for (const pattern of allPatterns) {
    if (pattern.extensions && pattern.extensions.length > 0) {
      if (!pattern.extensions.includes(ext)) continue;
    }

    // Reset regex state
    pattern.regex.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = pattern.regex.exec(content)) !== null) {
      // Find line number
      const upToMatch = content.slice(0, match.index);
      const lineNum = upToMatch.split('\n').length;

      // Skip matches inside comments
      const lineContent = lines[lineNum - 1] || '';
      const trimmed = lineContent.trimStart();
      if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*')) {
        continue;
      }

      // For TODO/FIXME, extract the actual message
      let desc = pattern.description;
      if (pattern.type === 'stubs' && match[0]) {
        desc = match[0].trim().slice(0, 100);
      }

      issues.push({
        id: `local-${Date.now()}-${issues.length}`,
        type: pattern.type,
        severity: pattern.severity,
        file: relativePath,
        line: lineNum,
        description: desc,
        status: 'found',
        source: 'local',
      });
    }
  }

  // --- Deterministic structural detectors ---
  if (['.ts', '.tsx'].includes(ext)) {
    issues.push(...detectMissingReturnTypesTS(content, relativePath));
    issues.push(...detectUnusedImports(content, relativePath, ext));
  } else if (['.js', '.jsx'].includes(ext)) {
    issues.push(...detectUnusedImports(content, relativePath, ext));
  }

  return issues;
}

/**
 * Run local scan on all files. Returns issues + set of files that had
 * local findings (useful for prioritizing AI scanning).
 * Accepts optional extra patterns contributed by plugins.
 */
export function localScanAll(
  filePaths: string[],
  cwd: string,
  extraPatterns: PluginPattern[] = [],
): { issues: Issue[]; flaggedFiles: Set<string> } {
  const allIssues: Issue[] = [];
  const flaggedFiles = new Set<string>();

  for (const fp of filePaths) {
    const fileIssues = localScanFile(fp, cwd, extraPatterns);
    if (fileIssues.length > 0) {
      allIssues.push(...fileIssues);
      flaggedFiles.add(path.relative(cwd, fp));
    }
  }

  return { issues: allIssues, flaggedFiles };
}
