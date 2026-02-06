/**
 * Layer 0: Local static analysis — zero API calls.
 *
 * Catches issues that don't need AI: hardcoded secrets, stubs, dangerous
 * function calls, SQL injection patterns, empty catches, etc. These are
 * reported directly and excluded from AI scanning to save token budget.
 */

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
    regex: /except\s*(?:\w+\s*)?:\s*(?:pass|\.\.\.)\s*$/gm,
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
];

/** Convert PluginPattern definitions into runtime Pattern objects. */
function compilePluginPatterns(pluginPatterns: PluginPattern[]): Pattern[] {
  const compiled: Pattern[] = [];
  for (const pp of pluginPatterns) {
    try {
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
      });
    }
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
