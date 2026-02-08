/**
 * Layer 1: Fingerprint scanning — compact file representations for AI triage.
 *
 * Instead of sending full file contents (~3000 tokens/file), we generate
 * compact fingerprints (~80-150 tokens/file) containing:
 *   - Function/class/method signatures
 *   - Import graph
 *   - "Hotspot" lines (security-sensitive patterns, error-prone constructs)
 *   - File statistics
 *
 * This lets us pack 15-25 files per 8K-token request, reducing a 33-request
 * scan to 3-5 requests. The model can detect most issue categories from
 * fingerprints alone: security, stubs, dead-code, types, duplicates.
 */

import * as fs from 'fs';
import * as path from 'path';
import { estimateTokens, getModelInputLimit } from './smart-split';

// ---------------------------------------------------------------------------
// Hotspot patterns — lines worth surfacing in fingerprints
// ---------------------------------------------------------------------------

interface HotspotPattern {
  regex: RegExp;
  label: string;
  extensions?: string[];
}

const HOTSPOT_PATTERNS: HotspotPattern[] = [
  // Security-sensitive
  { regex: /\beval\s*\(/, label: 'EVAL' },
  { regex: /\bexec\s*\(/, label: 'EXEC' },
  { regex: /\bos\.system\s*\(/, label: 'SHELL', extensions: ['.py'] },
  { regex: /\bsubprocess/, label: 'SUBPROCESS', extensions: ['.py'] },
  { regex: /\bchild_process/, label: 'CHILD_PROC', extensions: ['.ts', '.js'] },
  { regex: /dangerouslySetInnerHTML/, label: 'RAW_HTML', extensions: ['.tsx', '.jsx'] },
  { regex: /innerHTML\s*=/, label: 'RAW_HTML' },

  // SQL patterns
  { regex: /f["'][^"']*(?:SELECT|INSERT|UPDATE|DELETE)\b/i, label: 'SQL_FSTRING', extensions: ['.py'] },
  { regex: /`[^`]*(?:SELECT|INSERT|UPDATE|DELETE)\b[^`]*\$\{/i, label: 'SQL_TEMPLATE', extensions: ['.ts', '.js'] },
  { regex: /\.raw\s*\(|\.execute\s*\(/, label: 'RAW_QUERY' },

  // Error handling
  { regex: /except\s*(?:\w+\s*)?:\s*(?:pass|\.\.\.)\s*$/, label: 'EMPTY_EXCEPT', extensions: ['.py'] },
  { regex: /catch\s*\([^)]*\)\s*\{\s*\}/, label: 'EMPTY_CATCH' },

  // Secrets
  { regex: /(?:password|secret|api_key|token)\s*[=:]\s*['"][^'"]{6,}/, label: 'HARDCODED_SECRET' },

  // Stubs
  { regex: /\bTODO\b|\bFIXME\b|\bHACK\b|\bXXX\b/, label: 'STUB' },
  { regex: /NotImplementedError|not.implemented/i, label: 'NOT_IMPL' },

  // Type safety
  { regex: /:\s*any\b|as\s+any\b/, label: 'ANY_TYPE', extensions: ['.ts', '.tsx'] },
  { regex: /type:\s*ignore/, label: 'TYPE_IGNORE', extensions: ['.py'] },

  // Debugging leftovers
  { regex: /console\.log\s*\(/, label: 'CONSOLE_LOG', extensions: ['.ts', '.tsx', '.js', '.jsx'] },
  { regex: /\bprint\s*\((?!.*file\s*=)/, label: 'PRINT', extensions: ['.py'] },
  { regex: /\bdebugger\b/, label: 'DEBUGGER', extensions: ['.ts', '.tsx', '.js', '.jsx'] },
];

// ---------------------------------------------------------------------------
// Signature extraction
// ---------------------------------------------------------------------------

interface ExtractedSignature {
  kind: string;  // 'fn', 'class', 'method', 'const', 'interface', 'type'
  name: string;
  line: number;
  params?: string;
  returns?: string;
}

function extractSignaturesFromContent(content: string, ext: string): ExtractedSignature[] {
  const lines = content.split('\n');
  const sigs: ExtractedSignature[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();

    if (['.py'].includes(ext)) {
      // Python: def/async def/class
      const fnMatch = trimmed.match(/^(async\s+)?def\s+(\w+)\s*\(([^)]*)\)(?:\s*->\s*(.+?))?:/);
      if (fnMatch) {
        sigs.push({
          kind: 'fn',
          name: fnMatch[2],
          line: i + 1,
          params: fnMatch[3]?.trim(),
          returns: fnMatch[4]?.trim(),
        });
        continue;
      }
      const classMatch = trimmed.match(/^class\s+(\w+)(?:\(([^)]*)\))?:/);
      if (classMatch) {
        sigs.push({ kind: 'class', name: classMatch[1], line: i + 1, params: classMatch[2]?.trim() });
        continue;
      }
    }

    if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
      // TS/JS: function declarations — capture return type after closing paren
      const fnMatch = trimmed.match(/^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)\s*(?::\s*([^{]+?))?(?:\s*\{|$)/);
      if (fnMatch) {
        sigs.push({
          kind: 'fn',
          name: fnMatch[1],
          line: i + 1,
          params: fnMatch[2]?.trim(),
          returns: fnMatch[3]?.trim(),
        });
        continue;
      }
      const classMatch = trimmed.match(/^(?:export\s+)?class\s+(\w+)/);
      if (classMatch) {
        sigs.push({ kind: 'class', name: classMatch[1], line: i + 1 });
        continue;
      }
      // TS/JS: arrow / const functions — capture return type between `)` and `=>`
      const constMatch = trimmed.match(/^(?:export\s+)?const\s+(\w+)\s*(?::\s*([^=]+?))?\s*=\s*(?:async\s*)?\(([^)]*)\)\s*(?::\s*([^=>{]+?))?(?:\s*=>|$)/);
      if (constMatch) {
        // Return type can be on the variable annotation (constMatch[2]) or after the params (constMatch[4])
        const varType = constMatch[2]?.trim();
        const paramReturnType = constMatch[4]?.trim();
        sigs.push({
          kind: 'fn',
          name: constMatch[1],
          line: i + 1,
          params: constMatch[3]?.trim(),
          returns: paramReturnType || varType,
        });
        continue;
      }
      // Fallback: simpler const match for multi-line arrow functions
      const constSimple = trimmed.match(/^(?:export\s+)?const\s+(\w+)\s*(?::\s*([^=]+?))?\s*=\s*(?:async\s*)?\(/);
      if (constSimple) {
        sigs.push({
          kind: 'fn',
          name: constSimple[1],
          line: i + 1,
          returns: constSimple[2]?.trim(),
        });
        continue;
      }
      const ifaceMatch = trimmed.match(/^(?:export\s+)?(?:interface|type)\s+(\w+)/);
      if (ifaceMatch) {
        sigs.push({ kind: 'type', name: ifaceMatch[1], line: i + 1 });
        continue;
      }
    }

    if (['.go'].includes(ext)) {
      // Go: func Name(params) ReturnType { or func (r Recv) Name(params) (Multi, Return) {
      const fnMatch = trimmed.match(/^func\s+(?:\([^)]+\)\s+)?(\w+)\s*\(([^)]*)\)\s*([^{]*)/);
      if (fnMatch) {
        const retRaw = fnMatch[3]?.trim();
        sigs.push({
          kind: 'fn',
          name: fnMatch[1],
          line: i + 1,
          params: fnMatch[2]?.trim(),
          returns: retRaw || undefined,
        });
        continue;
      }
      const typeMatch = trimmed.match(/^type\s+(\w+)\s+(?:struct|interface)/);
      if (typeMatch) {
        sigs.push({ kind: 'type', name: typeMatch[1], line: i + 1 });
      }
    }

    if (['.java', '.kt'].includes(ext)) {
      // Java: modifier returnType name(params) { — capture return type
      const javaMatch = trimmed.match(/(?:public|private|protected)\s+(?:static\s+)?(\w[\w<>,\s]*?)\s+(\w+)\s*\(([^)]*)\)\s*(?:throws\s+\w+\s*)?[{]/);
      if (javaMatch && !['if', 'for', 'while', 'switch', 'catch'].includes(javaMatch[2])) {
        sigs.push({
          kind: 'fn',
          name: javaMatch[2],
          line: i + 1,
          params: javaMatch[3]?.trim(),
          returns: javaMatch[1]?.trim(),
        });
        continue;
      }
      // Kotlin: fun name(params): ReturnType { or suspend fun name(...)
      const ktMatch = trimmed.match(/(?:(?:public|private|internal|override)\s+)?(?:suspend\s+)?fun\s+(\w+)\s*\(([^)]*)\)\s*(?::\s*(\S+))?/);
      if (ktMatch) {
        sigs.push({
          kind: 'fn',
          name: ktMatch[1],
          line: i + 1,
          params: ktMatch[2]?.trim(),
          returns: ktMatch[3]?.trim(),
        });
        continue;
      }
    }

    // Rust: pub fn name(params) -> ReturnType {
    if (['.rs'].includes(ext)) {
      const rsMatch = trimmed.match(/^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)\s*(?:->\s*([^{]+?))?(?:\s*(?:where\s|{)|$)/);
      if (rsMatch) {
        sigs.push({
          kind: 'fn',
          name: rsMatch[1],
          line: i + 1,
          params: rsMatch[2]?.trim(),
          returns: rsMatch[3]?.trim(),
        });
        continue;
      }
      const rsTypeMatch = trimmed.match(/^(?:pub\s+)?(?:struct|enum|trait)\s+(\w+)/);
      if (rsTypeMatch) {
        sigs.push({ kind: 'type', name: rsTypeMatch[1], line: i + 1 });
      }
    }
  }

  return sigs;
}

// ---------------------------------------------------------------------------
// Import extraction (lightweight)
// ---------------------------------------------------------------------------

function extractImportLines(content: string, ext: string): string[] {
  const imports: string[] = [];

  if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
    for (const m of content.matchAll(/^import\s+.*?from\s+['"]([^'"]+)['"]/gm)) {
      imports.push(m[1]);
    }
  } else if (ext === '.py') {
    for (const m of content.matchAll(/^(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/gm)) {
      imports.push(m[1] || m[2]);
    }
  } else if (ext === '.go') {
    for (const m of content.matchAll(/"([^"]+)"/g)) {
      // Only project-local imports (no stdlib)
      if (m[1].includes('.') || m[1].includes('/')) imports.push(m[1]);
    }
  }

  return imports;
}

// ---------------------------------------------------------------------------
// Hotspot detection
// ---------------------------------------------------------------------------

interface Hotspot {
  line: number;
  label: string;
  snippet: string;  // trimmed line content, max 80 chars
}

function findHotspots(content: string, ext: string): Hotspot[] {
  const lines = content.split('\n');
  const hotspots: Hotspot[] = [];
  const seen = new Set<string>(); // dedupe by line

  for (const pattern of HOTSPOT_PATTERNS) {
    if (pattern.extensions && !pattern.extensions.includes(ext)) continue;

    for (let i = 0; i < lines.length; i++) {
      const key = `${i}:${pattern.label}`;
      if (seen.has(key)) continue;

      if (pattern.regex.test(lines[i])) {
        seen.add(key);
        hotspots.push({
          line: i + 1,
          label: pattern.label,
          snippet: lines[i].trim().slice(0, 80),
        });
      }
    }
  }

  return hotspots.sort((a, b) => a.line - b.line);
}

// ---------------------------------------------------------------------------
// Fingerprint generation
// ---------------------------------------------------------------------------

export interface FileFingerprint {
  relativePath: string;
  fullPath: string;
  lineCount: number;
  ext: string;
  imports: string[];
  signatures: ExtractedSignature[];
  hotspots: Hotspot[];
  /** Pre-rendered compact text representation. */
  text: string;
  tokens: number;
  /** Number of issues already caught locally for this file. */
  localIssueCount: number;
}

/**
 * Generate a compact fingerprint for a single file.
 * Typically 80-200 tokens depending on file size and complexity.
 *
 * When `localIssues` are provided, they're embedded in the fingerprint text
 * so the AI knows what Layer 0 already caught and can skip those.
 */
export function generateFingerprint(
  filePath: string,
  cwd: string,
  localIssues?: Array<{ line?: number; type: string; description: string }>,
): FileFingerprint | null {
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }

  const relativePath = path.relative(cwd, filePath);
  const ext = path.extname(filePath).toLowerCase();
  const lines = content.split('\n');
  const imports = extractImportLines(content, ext);
  const signatures = extractSignaturesFromContent(content, ext);
  const hotspots = findHotspots(content, ext);

  // Filter issues relevant to this file
  const fileLocalIssues = (localIssues || []).filter(Boolean);

  // Build compact text representation
  let text = `=== ${relativePath} (${lines.length} lines) ===\n`;

  if (imports.length > 0) {
    text += `IMPORTS: ${imports.slice(0, 10).join(', ')}`;
    if (imports.length > 10) text += ` +${imports.length - 10} more`;
    text += '\n';
  }

  if (signatures.length > 0) {
    const sigStrs = signatures.map(s => {
      let str = `L${s.line}:${s.name}`;
      if (s.params !== undefined) str += `(${s.params.slice(0, 60)})`;
      if (s.returns) {
        str += `->${s.returns.slice(0, 40)}`;
      } else {
        str += ' [NO_RETURN_TYPE]';
      }
      return str;
    });
    text += `DEFS: ${sigStrs.join(', ')}\n`;
  }

  if (hotspots.length > 0) {
    text += 'FLAGS:\n';
    for (const h of hotspots.slice(0, 8)) {
      text += `  L${h.line} [${h.label}]: ${h.snippet}\n`;
    }
    if (hotspots.length > 8) {
      text += `  +${hotspots.length - 8} more hotspots\n`;
    }
  }

  // Option 5: Embed local findings so the AI knows what's already caught
  if (fileLocalIssues.length > 0) {
    text += 'ALREADY_CAUGHT_LOCALLY:\n';
    for (const li of fileLocalIssues.slice(0, 6)) {
      text += `  L${li.line || '?'}:${li.type}: ${li.description.slice(0, 60)}\n`;
    }
    if (fileLocalIssues.length > 6) {
      text += `  +${fileLocalIssues.length - 6} more local issues\n`;
    }
  }

  const tokens = estimateTokens(text);

  return {
    relativePath, fullPath: filePath, lineCount: lines.length, ext,
    imports, signatures, hotspots, text, tokens,
    localIssueCount: fileLocalIssues.length,
  };
}

// ---------------------------------------------------------------------------
// Fingerprint packing — group fingerprints into token-budgeted chunks
// ---------------------------------------------------------------------------

export interface FingerprintChunk {
  fingerprints: FileFingerprint[];
  totalTokens: number;
  promptText: string;
}

/**
 * Pack fingerprints into chunks that fit within the model's token budget.
 * Returns ready-to-send prompt text for each chunk.
 */
export function packFingerprints(
  fingerprints: FileFingerprint[],
  model: string,
): FingerprintChunk[] {
  const modelLimit = getModelInputLimit(model);
  // Budget: model limit - overhead (system msg ~25, schema ~150, prompt frame ~150, safety ~175)
  const OVERHEAD = 500;
  const budgetTokens = modelLimit - OVERHEAD;

  const chunks: FingerprintChunk[] = [];
  let current: FileFingerprint[] = [];
  let currentTokens = 0;

  // Sort: hotspot-heavy files first (they're more interesting to scan)
  const sorted = [...fingerprints].sort((a, b) => b.hotspots.length - a.hotspots.length);

  for (const fp of sorted) {
    if (currentTokens + fp.tokens > budgetTokens && current.length > 0) {
      chunks.push(buildFingerprintChunk(current, currentTokens, chunks.length + 1));
      current = [];
      currentTokens = 0;
    }
    current.push(fp);
    currentTokens += fp.tokens;
  }

  if (current.length > 0) {
    chunks.push(buildFingerprintChunk(current, currentTokens, chunks.length + 1));
  }

  return chunks;
}

function buildFingerprintChunk(
  fingerprints: FileFingerprint[],
  totalTokens: number,
  chunkNum: number,
): FingerprintChunk {
  const fileCount = fingerprints.length;
  const hotspotCount = fingerprints.reduce((n, f) => n + f.hotspots.length, 0);

  const localCaughtCount = fingerprints.reduce((n, f) => n + f.localIssueCount, 0);

  let promptText = `Analyze these ${fileCount} file fingerprints for code quality issues.
Each fingerprint shows: file path, line count, imports, function/class signatures (with line numbers and return types), and flagged hotspot lines.

Signature annotations:
- L42:funcName(params)->ReturnType  — function at line 42 WITH a return type
- L42:funcName(params) [NO_RETURN_TYPE]  — function at line 42 WITHOUT a return type
${localCaughtCount > 0 ? `\nIMPORTANT: Some files have an ALREADY_CAUGHT_LOCALLY section listing issues that our static analyzer already detected. Do NOT re-report these issues. Focus only on NEW issues the static analyzer cannot catch.\n` : ''}
Focus your analysis on issues that require REASONING — things a static analyzer cannot catch:
- SECURITY: Injection patterns, auth bypass, data exposure, unsafe data flows between functions.
- BUGS: Logic errors, race conditions, incorrect error handling, edge cases.
- DEAD-CODE: Functions/classes defined but never referenced by other files in the import graph.
- DUPLICATES: Similar function signatures across different files that should be shared.

DO NOT report these (already handled by local static analysis):
- Missing return types, console.log/debugger/print, any-type usage, unused imports, TODO/FIXME markers

CRITICAL — avoid false positives:
- ORM query builders, parameterized queries, and prepared statements are NOT SQL injection — regardless of language or framework. Only flag raw SQL strings with unsanitized user input directly interpolated.
- String interpolation in log messages, error messages, or print statements is NOT SQL injection. SQL injection requires the string to reach a database query.
- Decorated route handlers or annotated endpoints where the framework infers the return type are NOT missing return types.
- Config defaults, environment variable fallbacks, and placeholder values are NOT hardcoded secrets.
- Input validation models or schemas that accept sensitive fields are normal. Only flag secrets appearing unmasked in responses or logs.
- Abstract methods, interface implementations, or overrides may intentionally omit types to match a parent signature.
- Re-export modules and package init files are NOT dead code.
- Test files: mock data, fixtures, assertions, and test helpers are NOT real issues. Only flag actual bugs in test logic.
- Catching specific exception types (e.g. narrowly-scoped errors) and ignoring them is intentional — only flag broad catch-all exception handlers.

RULES:
- Only report REAL issues clearly visible from the fingerprints. No speculation.
- Be specific: exact file, use the exact line number from the L-prefixed signatures/flags.
- Provide the evidence field with the exact code pattern you observed.
- If everything looks clean, return an empty issues array. Prefer returning fewer, high-confidence issues over many uncertain ones.

${hotspotCount > 0 ? `Note: ${hotspotCount} hotspot lines flagged across ${fileCount} files.\n` : ''}
FILE FINGERPRINTS:

`;

  for (const fp of fingerprints) {
    promptText += fp.text + '\n';
  }

  return { fingerprints, totalTokens, promptText };
}
