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
      // TS/JS: function, class, const arrow, export
      const fnMatch = trimmed.match(/^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)/);
      if (fnMatch) {
        sigs.push({ kind: 'fn', name: fnMatch[1], line: i + 1, params: fnMatch[2]?.trim() });
        continue;
      }
      const classMatch = trimmed.match(/^(?:export\s+)?class\s+(\w+)/);
      if (classMatch) {
        sigs.push({ kind: 'class', name: classMatch[1], line: i + 1 });
        continue;
      }
      const constMatch = trimmed.match(/^(?:export\s+)?const\s+(\w+)\s*(?::\s*\w+)?\s*=\s*(?:async\s*)?\(/);
      if (constMatch) {
        sigs.push({ kind: 'fn', name: constMatch[1], line: i + 1 });
        continue;
      }
      const ifaceMatch = trimmed.match(/^(?:export\s+)?(?:interface|type)\s+(\w+)/);
      if (ifaceMatch) {
        sigs.push({ kind: 'type', name: ifaceMatch[1], line: i + 1 });
        continue;
      }
    }

    if (['.go'].includes(ext)) {
      const fnMatch = trimmed.match(/^func\s+(?:\([^)]+\)\s+)?(\w+)\s*\(/);
      if (fnMatch) {
        sigs.push({ kind: 'fn', name: fnMatch[1], line: i + 1 });
        continue;
      }
      const typeMatch = trimmed.match(/^type\s+(\w+)\s+(?:struct|interface)/);
      if (typeMatch) {
        sigs.push({ kind: 'type', name: typeMatch[1], line: i + 1 });
      }
    }

    if (['.java', '.kt'].includes(ext)) {
      const fnMatch = trimmed.match(/(?:public|private|protected)?\s*(?:static\s+)?(?:\w+\s+)?(\w+)\s*\([^)]*\)\s*(?:throws\s+\w+\s*)?[{:]/);
      if (fnMatch && !['if', 'for', 'while', 'switch', 'catch'].includes(fnMatch[1])) {
        sigs.push({ kind: 'fn', name: fnMatch[1], line: i + 1 });
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
}

/**
 * Generate a compact fingerprint for a single file.
 * Typically 80-200 tokens depending on file size and complexity.
 */
export function generateFingerprint(filePath: string, cwd: string): FileFingerprint | null {
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

  // Build compact text representation
  let text = `=== ${relativePath} (${lines.length} lines) ===\n`;

  if (imports.length > 0) {
    text += `IMPORTS: ${imports.slice(0, 10).join(', ')}`;
    if (imports.length > 10) text += ` +${imports.length - 10} more`;
    text += '\n';
  }

  if (signatures.length > 0) {
    const sigStrs = signatures.map(s => {
      let str = `${s.name}`;
      if (s.params !== undefined) str += `(${s.params.slice(0, 60)})`;
      if (s.returns) str += `->${s.returns}`;
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

  const tokens = estimateTokens(text);

  return { relativePath, fullPath: filePath, lineCount: lines.length, ext, imports, signatures, hotspots, text, tokens };
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

  let promptText = `Analyze these ${fileCount} file fingerprints for code quality issues.
Each fingerprint shows: file path, line count, imports, function/class signatures, and flagged hotspot lines.

You can detect most issues from this information:
- SECURITY: Look at hotspot flags (EVAL, SQL_FSTRING, HARDCODED_SECRET, etc.) and function signatures that handle user input.
- BUGS: Empty catch/except blocks, missing error handling in function signatures, suspicious patterns.
- TYPES: ANY_TYPE flags, TYPE_IGNORE flags, function signatures missing return types.
- STUBS: STUB and NOT_IMPL flags.
- DEAD-CODE: Functions/classes defined but never referenced by other files in the import graph.
- DUPLICATES: Similar function signatures across different files.
- LINT: CONSOLE_LOG/PRINT/DEBUGGER flags, unused imports.
- COVERAGE: Public functions with no apparent test coverage.

RULES:
- Only report REAL issues visible from the fingerprints. No speculation.
- Be specific: exact file, exact line number, exact description.
- Hotspot flags are hints, not confirmed issues — verify from context before reporting.
- If everything looks clean, return an empty issues array.

${hotspotCount > 0 ? `Note: ${hotspotCount} hotspot lines flagged across ${fileCount} files.\n` : ''}
FILE FINGERPRINTS:

`;

  for (const fp of fingerprints) {
    promptText += fp.text + '\n';
  }

  return { fingerprints, totalTokens, promptText };
}
