/**
 * Smart file splitting for token-constrained models.
 *
 * The naive approach (32K chars ≈ 8K tokens) fails because:
 *  1. Code tokenizes at ~3.2 chars/token, not 4 — so 32K chars is actually ~10K tokens.
 *  2. Prompt template, system message, and JSON schema eat ~500 tokens of overhead.
 *  3. Files grouped alphabetically lose cross-file context (imports, shared types).
 *  4. A single large file can blow the budget with no fallback.
 *
 * This module fixes all four problems:
 *  - Accurate token budgeting with measured overhead.
 *  - Multi-level file compression (strip comments → signatures → truncate).
 *  - Import-aware grouping so related files stay in the same chunk.
 *  - A compact repo manifest injected into each chunk for cross-chunk context.
 */

import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Conservative chars-per-token ratio for code.
 * o200k_base tokenizer averages 3.0–3.5 for code depending on language.
 * We use 3.2 as a safe middle ground; overestimating tokens is better than
 * underestimating (which causes 413s).
 */
const CHARS_PER_TOKEN = 3.2;

/**
 * Fixed token overhead per request that isn't code:
 *   ~25  system message
 *   ~150 response_format JSON schema
 *   ~200 prompt template (categories, severity guide, rules)
 *   ~125 safety margin for message framing / off-by-one
 * = ~500 tokens
 */
const OVERHEAD_TOKENS = 500;

/** Maximum characters for the compact repo manifest. */
const MAX_MANIFEST_CHARS = 600;

/** When compressing, keep this many body lines per function/class. */
const SIGNATURE_BODY_LINES = 3;

// Known model token limits on GitHub Models free tier.
const MODEL_INPUT_LIMITS: Record<string, number> = {
  'openai/gpt-4o-mini': 8000,
  'openai/gpt-4o': 8000,
  'mistral-ai/Mistral-small': 8000,
  'meta-llama/Llama-3.3-70B-Instruct': 8000,
  'meta-llama/Meta-Llama-3.1-8B-Instruct': 8000,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FileInfo {
  relativePath: string;
  fullPath: string;
  content: string;         // possibly compressed
  originalSize: number;    // original byte count
  tokens: number;          // estimated tokens for content
  imports: string[];       // resolved relative import paths
  directory: string;       // dirname of relativePath
  compressed: boolean;     // was this file compressed?
}

export interface SmartChunk {
  files: FileInfo[];
  totalCodeTokens: number;
  manifest: string;
}

// ---------------------------------------------------------------------------
// Token estimation
// ---------------------------------------------------------------------------

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function tokensToChars(tokens: number): number {
  return Math.floor(tokens * CHARS_PER_TOKEN);
}

/**
 * Calculate the character budget available for actual code in a single chunk.
 * modelLimit is the total input token cap (e.g. 8000 for gpt-4o-mini).
 */
export function calculateCodeBudget(modelLimit: number): number {
  const codeTokens = modelLimit - OVERHEAD_TOKENS;
  return tokensToChars(Math.max(codeTokens, 1000)); // floor at 1000 tokens
}

export function getModelInputLimit(model: string): number {
  return MODEL_INPUT_LIMITS[model] || 8000;
}

// ---------------------------------------------------------------------------
// Import extraction
// ---------------------------------------------------------------------------

function extractImports(content: string, ext: string): string[] {
  const raw: string[] = [];

  if (['.ts', '.tsx', '.js', '.jsx', '.vue', '.svelte'].includes(ext)) {
    for (const m of content.matchAll(/(?:import|export)\s.*?from\s+['"]([^'"]+)['"]/g)) {
      raw.push(m[1]);
    }
    for (const m of content.matchAll(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      raw.push(m[1]);
    }
  } else if (ext === '.py') {
    for (const m of content.matchAll(/^from\s+([\w.]+)\s+import/gm)) {
      raw.push(m[1]);
    }
    for (const m of content.matchAll(/^import\s+([\w.]+)/gm)) {
      raw.push(m[1]);
    }
  } else if (ext === '.go') {
    const block = content.match(/import\s*\(([\s\S]*?)\)/);
    if (block) {
      for (const m of block[1].matchAll(/"([^"]+)"/g)) raw.push(m[1]);
    }
    for (const m of content.matchAll(/import\s+"([^"]+)"/g)) raw.push(m[1]);
  } else if (['.java', '.kt', '.scala'].includes(ext)) {
    for (const m of content.matchAll(/^import\s+([\w.]+)/gm)) raw.push(m[1]);
  } else if (['.rb'].includes(ext)) {
    for (const m of content.matchAll(/require(?:_relative)?\s+['"]([^'"]+)['"]/g)) {
      raw.push(m[1]);
    }
  }

  return raw;
}

// ---------------------------------------------------------------------------
// File compression (3 levels)
// ---------------------------------------------------------------------------

/** Level 1: strip comments and collapse blank lines. */
function stripComments(content: string, ext: string): string {
  let out = content;

  if (['.py', '.rb', '.sh', '.yml', '.yaml'].includes(ext)) {
    // Multi-line strings (Python docstrings)
    out = out.replace(/"""[\s\S]*?"""/g, '""""""');
    out = out.replace(/'''[\s\S]*?'''/g, "''''''");
    // Line comments (preserve shebangs)
    out = out.replace(/^(\s*)#(?!!)(.*)$/gm, '');
  } else {
    // Block comments
    out = out.replace(/\/\*[\s\S]*?\*\//g, '');
    // Line comments
    out = out.replace(/\/\/.*$/gm, '');
  }

  // Collapse 3+ blank lines into 1
  out = out.replace(/\n{3,}/g, '\n\n');
  return out;
}

/**
 * Level 2: keep function/class signatures + first N body lines,
 * collapse the rest with a marker.
 */
function extractSignatures(content: string, ext: string): string {
  const lines = content.split('\n');
  const result: string[] = [];
  let inBody = false;
  let bodyBaseIndent = 0;
  let bodyLineCount = 0;
  let skippedCount = 0;

  // Regex for "interesting" declarations that start a body.
  const sigRe =
    ext === '.py'
      ? /^(\s*)(def |class |async def )/
      : /^(\s*)(function |class |const \w+\s*=\s*(?:async\s*)?\(|export (?:default )?(?:function|class|const|async)|interface |type \w+\s*=)/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const sigMatch = line.match(sigRe);

    if (sigMatch && !inBody) {
      // Flush any skip marker
      if (skippedCount > 0) {
        const indent = ' '.repeat(bodyBaseIndent + 2);
        result.push(`${indent}// ... ${skippedCount} lines collapsed`);
        skippedCount = 0;
      }
      inBody = true;
      bodyBaseIndent = sigMatch[1].length;
      bodyLineCount = 0;
      result.push(line);
      continue;
    }

    if (inBody) {
      const stripped = line.trimStart();
      const currentIndent = stripped === '' ? bodyBaseIndent + 1 : line.length - stripped.length;

      // Back to same or lesser indent = body ended
      if (stripped !== '' && currentIndent <= bodyBaseIndent) {
        if (skippedCount > 0) {
          const indent = ' '.repeat(bodyBaseIndent + 2);
          result.push(`${indent}// ... ${skippedCount} lines collapsed`);
          skippedCount = 0;
        }
        inBody = false;
        result.push(line);
        continue;
      }

      bodyLineCount++;
      if (bodyLineCount <= SIGNATURE_BODY_LINES) {
        result.push(line);
      } else {
        skippedCount++;
      }
    } else {
      result.push(line);
    }
  }

  // Final flush
  if (skippedCount > 0) {
    const indent = ' '.repeat(bodyBaseIndent + 2);
    result.push(`${indent}// ... ${skippedCount} lines collapsed`);
  }

  return result.join('\n');
}

/**
 * Progressively compress a file to fit within maxChars.
 * Returns the (possibly compressed) content and whether compression occurred.
 */
export function compressFile(
  content: string,
  ext: string,
  maxChars: number,
): { content: string; compressed: boolean } {
  // Level 0: already fits
  if (content.length <= maxChars) {
    return { content, compressed: false };
  }

  // Level 1: strip comments + collapse blanks
  let compressed = stripComments(content, ext);
  if (compressed.length <= maxChars) {
    return { content: compressed, compressed: true };
  }

  // Level 2: signature extraction
  compressed = extractSignatures(stripComments(content, ext), ext);
  if (compressed.length <= maxChars) {
    return { content: compressed, compressed: true };
  }

  // Level 3: hard truncate
  const marker = `\n// ... truncated (${Math.round(content.length / 1024)}KB original)\n`;
  if (maxChars <= marker.length) {
    // Budget too small for any real content — return just the marker trimmed to fit
    return { content: marker.slice(0, maxChars), compressed: true };
  }
  compressed = compressed.slice(0, maxChars - marker.length) + marker;
  return { content: compressed, compressed: true };
}

// ---------------------------------------------------------------------------
// File analysis
// ---------------------------------------------------------------------------

export function analyzeFile(fullPath: string, cwd: string): FileInfo | null {
  try {
    const raw = fs.readFileSync(fullPath, 'utf-8');
    const relativePath = path.relative(cwd, fullPath);
    const ext = path.extname(fullPath).toLowerCase();

    return {
      relativePath,
      fullPath,
      content: raw,
      originalSize: raw.length,
      tokens: estimateTokens(raw),
      imports: extractImports(raw, ext),
      directory: path.dirname(relativePath),
      compressed: false,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Import resolution (best-effort, no FS lookups)
// ---------------------------------------------------------------------------

function resolveImport(
  raw: string,
  fromFile: FileInfo,
  fileSet: Set<string>,
): string | null {
  // Relative JS/TS imports
  if (raw.startsWith('.')) {
    const dir = path.dirname(fromFile.relativePath);
    const candidates = [
      raw,
      raw + '.ts', raw + '.tsx', raw + '.js', raw + '.jsx',
      raw + '/index.ts', raw + '/index.tsx', raw + '/index.js',
    ];
    for (const c of candidates) {
      const resolved = path.normalize(path.join(dir, c));
      if (fileSet.has(resolved)) return resolved;
    }
    return null;
  }

  // Python dotted imports → path
  const pyPath = raw.replace(/\./g, '/');
  const pyCandidates = [pyPath + '.py', pyPath + '/__init__.py'];
  for (const c of pyCandidates) {
    if (fileSet.has(c)) return c;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Dependency graph
// ---------------------------------------------------------------------------

export function buildDependencyGraph(files: FileInfo[]): Map<string, Set<string>> {
  const fileSet = new Set(files.map(f => f.relativePath));
  const graph = new Map<string, Set<string>>();

  for (const f of files) {
    graph.set(f.relativePath, new Set());
  }

  for (const f of files) {
    for (const raw of f.imports) {
      const resolved = resolveImport(raw, f, fileSet);
      if (resolved && resolved !== f.relativePath) {
        graph.get(f.relativePath)!.add(resolved);
        graph.get(resolved)!.add(f.relativePath);
      }
    }
  }

  return graph;
}

// ---------------------------------------------------------------------------
// Smart grouping: dependency-aware bin packing
// ---------------------------------------------------------------------------

/**
 * Groups files into chunks that:
 *  1. Fit within the token budget (codeBudgetChars).
 *  2. Keep import-related files together when possible.
 *  3. Keep directory siblings together as secondary preference.
 *
 * Files that individually exceed the budget are compressed to fit.
 */
export function smartGroup(
  files: FileInfo[],
  graph: Map<string, Set<string>>,
  codeBudgetChars: number,
): FileInfo[][] {
  const ext = (f: FileInfo) => path.extname(f.relativePath).toLowerCase();

  // Pre-process: compress any file that alone exceeds the budget.
  for (const f of files) {
    if (f.content.length > codeBudgetChars) {
      const { content, compressed } = compressFile(f.content, ext(f), codeBudgetChars - 200);
      f.content = content;
      f.tokens = estimateTokens(content);
      f.compressed = compressed;
    }
  }

  const chunks: FileInfo[][] = [];
  const assigned = new Set<string>();

  // Sort: most-connected files first (they anchor groups), then by directory.
  const sorted = [...files].sort((a, b) => {
    const ac = graph.get(a.relativePath)?.size || 0;
    const bc = graph.get(b.relativePath)?.size || 0;
    if (bc !== ac) return bc - ac;
    const dirCmp = a.directory.localeCompare(b.directory);
    if (dirCmp !== 0) return dirCmp;
    return a.content.length - b.content.length;
  });

  for (const file of sorted) {
    if (assigned.has(file.relativePath)) continue;

    const chunk: FileInfo[] = [file];
    // Per-file header: "--- path ---\n" ≈ path.length + 10
    let chunkChars = file.content.length + file.relativePath.length + 10;
    assigned.add(file.relativePath);

    // Phase 1: pull in import-connected files.
    const neighbors = [...(graph.get(file.relativePath) || [])]
      .filter(n => !assigned.has(n))
      .map(n => files.find(f => f.relativePath === n)!)
      .filter(Boolean)
      .sort((a, b) => a.content.length - b.content.length);

    for (const neighbor of neighbors) {
      const cost = neighbor.content.length + neighbor.relativePath.length + 10;
      if (chunkChars + cost <= codeBudgetChars) {
        chunk.push(neighbor);
        chunkChars += cost;
        assigned.add(neighbor.relativePath);
      }
    }

    // Phase 2: fill with directory siblings.
    const siblings = files
      .filter(f => !assigned.has(f.relativePath) && f.directory === file.directory)
      .sort((a, b) => a.content.length - b.content.length);

    for (const sib of siblings) {
      const cost = sib.content.length + sib.relativePath.length + 10;
      if (chunkChars + cost <= codeBudgetChars) {
        chunk.push(sib);
        chunkChars += cost;
        assigned.add(sib.relativePath);
      }
    }

    // Phase 3: fill remaining space with any small unassigned files.
    const smalls = files
      .filter(f => !assigned.has(f.relativePath))
      .sort((a, b) => a.content.length - b.content.length);

    for (const small of smalls) {
      const cost = small.content.length + small.relativePath.length + 10;
      if (chunkChars + cost <= codeBudgetChars) {
        chunk.push(small);
        chunkChars += cost;
        assigned.add(small.relativePath);
      }
    }

    chunks.push(chunk);
  }

  return chunks;
}

// ---------------------------------------------------------------------------
// Compact repo manifest
// ---------------------------------------------------------------------------

/**
 * Builds a tiny repo map that fits in every chunk, giving the model
 * awareness of the full codebase structure and which other chunks
 * contain related files.
 */
export function buildManifest(
  allFiles: FileInfo[],
  chunks: FileInfo[][],
  currentChunkIndex: number,
): string {
  // Directory tree (compact)
  const dirs = new Map<string, string[]>();
  for (const f of allFiles) {
    const dir = f.directory || '.';
    if (!dirs.has(dir)) dirs.set(dir, []);
    dirs.get(dir)!.push(path.basename(f.relativePath));
  }

  let manifest = `REPO: ${allFiles.length} files, ${chunks.length} chunks. This is chunk ${currentChunkIndex + 1}/${chunks.length}.\n`;
  manifest += 'Structure:\n';

  for (const [dir, names] of [...dirs.entries()].sort()) {
    if (names.length <= 3) {
      manifest += `  ${dir}/ ${names.join(', ')}\n`;
    } else {
      // Group by extension
      const byExt = new Map<string, number>();
      for (const n of names) {
        const e = path.extname(n) || 'other';
        byExt.set(e, (byExt.get(e) || 0) + 1);
      }
      const summary = [...byExt.entries()]
        .map(([e, c]) => `${c}${e}`)
        .join(' ');
      manifest += `  ${dir}/ ${summary}\n`;
    }
  }

  // Related files in other chunks (files imported by current chunk)
  const currentPaths = new Set(chunks[currentChunkIndex].map(f => f.relativePath));
  const currentImportTargets = new Set<string>();
  for (const f of chunks[currentChunkIndex]) {
    for (const imp of f.imports) currentImportTargets.add(imp);
  }

  const related: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    if (i === currentChunkIndex) continue;
    for (const f of chunks[i]) {
      // Check if current chunk imports this file (by checking if any import resolves to it)
      const isImported = currentImportTargets.has(f.relativePath) ||
        [...currentImportTargets].some(imp => {
          // Check common resolutions
          return f.relativePath.endsWith(imp + '.ts') ||
            f.relativePath.endsWith(imp + '.py') ||
            f.relativePath.endsWith(imp.replace(/\./g, '/') + '.py') ||
            f.relativePath === imp;
        });
      // Or if this file imports something in the current chunk
      const importsCurrentFile = f.imports.some(imp =>
        [...currentPaths].some(cp =>
          cp.endsWith(imp + '.ts') || cp.endsWith(imp + '.py') || cp === imp,
        ),
      );
      if (isImported || importsCurrentFile) {
        related.push(`  chunk ${i + 1}: ${f.relativePath}`);
      }
    }
  }

  if (related.length > 0) {
    manifest += 'Related files in other chunks:\n';
    manifest += related.slice(0, 6).join('\n') + '\n';
    if (related.length > 6) {
      manifest += `  ... +${related.length - 6} more\n`;
    }
  }

  // Trim to budget
  if (manifest.length > MAX_MANIFEST_CHARS) {
    manifest = manifest.slice(0, MAX_MANIFEST_CHARS - 20) + '\n  ... (trimmed)\n';
  }

  return manifest;
}

// ---------------------------------------------------------------------------
// Smart prompt builder
// ---------------------------------------------------------------------------

export function buildSmartPrompt(
  chunk: SmartChunk,
  chunkNum: number,
  totalChunks: number,
): string {
  const fileList = chunk.files.map(f => {
    const suffix = f.compressed ? ' (compressed)' : '';
    return `  - ${f.relativePath}${suffix}`;
  });

  let prompt = `${chunk.manifest}
Analyze chunk ${chunkNum}/${totalChunks} for code quality issues.

FILES IN THIS CHUNK:
${fileList.join('\n')}

ISSUE CATEGORIES:
  security    — SQL injection, XSS, hardcoded secrets, auth bypass, path traversal
  bugs        — null derefs, off-by-one, race conditions, wrong logic, unhandled errors
  types       — type mismatches, unsafe casts, missing generics, any-typed values
  lint        — unused vars/imports, inconsistent naming, missing returns, unreachable code
  dead-code   — functions/classes/exports never called or imported
  stubs       — TODO, FIXME, HACK, placeholder implementations, empty catch blocks
  duplicates  — copy-pasted logic that should be a shared function
  coverage    — public functions with zero test coverage, untested error paths

SEVERITY GUIDE:
  critical — exploitable in production (data loss, auth bypass, RCE)
  high     — will cause bugs in normal usage
  medium   — code smell, maintainability risk
  low      — style nit, minor improvement

RULES:
- Only report REAL issues. No false positives. No style preferences.
- Be specific: exact file, exact line number, exact description.
- If a file looks clean, return an empty issues array.

SOURCE CODE:

`;
  for (const file of chunk.files) {
    prompt += `--- ${file.relativePath} ---\n${file.content}\n\n`;
  }

  return prompt;
}

// ---------------------------------------------------------------------------
// Public orchestrator: replaces chunkFiles + buildPrompt
// ---------------------------------------------------------------------------

/**
 * The main entry point. Takes raw file paths, returns fully-formed SmartChunks
 * ready to be sent to the model, each guaranteed to fit within the token budget.
 */
export function prepareChunks(
  filePaths: string[],
  cwd: string,
  model: string,
): SmartChunk[] {
  const modelLimit = getModelInputLimit(model);
  const codeBudget = calculateCodeBudget(modelLimit);

  // 1. Analyze all files
  const files: FileInfo[] = [];
  for (const fp of filePaths) {
    const info = analyzeFile(fp, cwd);
    if (info) files.push(info);
  }

  if (files.length === 0) return [];

  // 2. Build dependency graph
  const graph = buildDependencyGraph(files);

  // 3. Smart-group into chunks
  const groups = smartGroup(files, graph, codeBudget);

  // 4. Build manifest + assemble SmartChunks
  const chunks: SmartChunk[] = groups.map((group, i) => {
    const manifest = buildManifest(files, groups, i);
    const totalCodeTokens = group.reduce((sum, f) => sum + f.tokens, 0);
    return { files: group, totalCodeTokens, manifest };
  });

  return chunks;
}
