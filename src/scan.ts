import * as core from '@actions/core';
import * as fs from 'fs';
import * as path from 'path';
import * as github from '@actions/github';
import { callGitHubModels, TokenLimitError } from './github-models';
import { SloppyConfig, Issue, ScanResult, IssueType, Severity, PluginContext } from './types';
import {
  prepareChunks,
  buildSmartPrompt,
  compressFile,
  estimateTokens,
  getModelInputLimit,
  calculateCodeBudget,
  SmartChunk,
} from './smart-split';
import { localScanAll } from './local-scan';
import { runHook, applyFilters } from './plugins';
import { generateFingerprint, packFingerprints, FingerprintChunk } from './fingerprint';
import { partitionByCache, updateCacheEntries, saveCache, ScanStrategy } from './scan-cache';

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.py', '.rb', '.go', '.rs', '.java',
  '.c', '.cpp', '.h', '.hpp', '.cs', '.php', '.swift', '.kt', '.scala',
  '.vue', '.svelte', '.html', '.css', '.scss', '.sql', '.sh', '.yaml',
  '.yml', '.json', '.toml', '.xml', '.dockerfile',
]);

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', 'vendor',
  '__pycache__', '.venv', 'venv', 'target', 'coverage', '.sloppy',
]);

// Structured output schema — the model MUST conform to this exact shape.
const ISSUES_SCHEMA = {
  type: 'json_schema' as const,
  json_schema: {
    name: 'scan_results',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        issues: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['security', 'bugs', 'types', 'lint', 'dead-code', 'stubs', 'duplicates', 'coverage'],
              },
              severity: {
                type: 'string',
                enum: ['critical', 'high', 'medium', 'low'],
              },
              file: { type: 'string' },
              line: { type: 'number' },
              description: { type: 'string' },
            },
            required: ['type', 'severity', 'file', 'line', 'description'],
            additionalProperties: false,
          },
        },
      },
      required: ['issues'],
      additionalProperties: false,
    },
  },
};

function collectFiles(dir: string, files: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.github') continue;
    if (IGNORE_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(full, files);
    } else if (CODE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      files.push(full);
    }
  }
  return files;
}

async function collectPrFiles(cwd: string): Promise<string[] | null> {
  const ctx = github.context;
  const prNumber = ctx.payload.pull_request?.number;
  if (!prNumber) return null;

  const token = process.env.GITHUB_TOKEN || core.getInput('github-token');
  if (!token) return null;

  try {
    const octokit = github.getOctokit(token);
    const files: string[] = [];
    let page = 1;

    while (true) {
      const { data } = await octokit.rest.pulls.listFiles({
        ...ctx.repo,
        pull_number: prNumber,
        per_page: 100,
        page,
      });
      if (data.length === 0) break;

      for (const file of data) {
        if (file.status === 'removed') continue;
        const ext = path.extname(file.filename).toLowerCase();
        if (!CODE_EXTENSIONS.has(ext)) continue;
        const full = path.join(cwd, file.filename);
        if (fs.existsSync(full)) files.push(full);
      }

      if (data.length < 100) break;
      page++;
    }

    return files;
  } catch (e) {
    core.warning(`Could not fetch PR files: ${e}. Falling back to full scan.`);
    return null;
  }
}

function parseIssues(content: string): Issue[] {
  try {
    const data = JSON.parse(content);
    return (data.issues || []).map((raw: any, i: number) => ({
      id: `scan-${Date.now()}-${i}`,
      type: (raw.type || 'lint') as IssueType,
      severity: (raw.severity || 'medium') as Severity,
      file: raw.file || 'unknown',
      line: raw.line || undefined,
      description: raw.description || 'Unknown issue',
      status: 'found' as const,
    }));
  } catch {
    try {
      const match = content.match(/\{[\s\S]*\}/);
      if (!match) return [];
      const data = JSON.parse(match[0]);
      return (data.issues || []).map((raw: any, i: number) => ({
        id: `scan-${Date.now()}-${i}`,
        type: (raw.type || 'lint') as IssueType,
        severity: (raw.severity || 'medium') as Severity,
        file: raw.file || 'unknown',
        line: raw.line || undefined,
        description: raw.description || 'Unknown issue',
        status: 'found' as const,
      }));
    } catch {
      core.warning('Failed to parse scan response');
      return [];
    }
  }
}

export function calculateScore(issues: Issue[]): number {
  const penalties: Record<Severity, number> = { critical: 10, high: 5, medium: 2, low: 1 };
  let score = 100;
  for (const issue of issues) {
    score -= penalties[issue.severity] || 1;
  }
  return Math.max(0, Math.min(100, score));
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `${m}m${rem}s` : `${m}m`;
}

// ---------------------------------------------------------------------------
// Layer 1: Fingerprint scanning (compact representations → fewer API calls)
// ---------------------------------------------------------------------------

async function runFingerprintScan(
  filePaths: string[],
  cwd: string,
  model: string,
  customPrompt?: string,
): Promise<{ issues: Issue[]; tokens: number; apiCalls: number }> {
  // Generate fingerprints for all files
  const fingerprints = filePaths
    .map(fp => generateFingerprint(fp, cwd))
    .filter((fp): fp is NonNullable<typeof fp> => fp !== null);

  if (fingerprints.length === 0) return { issues: [], tokens: 0, apiCalls: 0 };

  const totalHotspots = fingerprints.reduce((n, f) => n + f.hotspots.length, 0);
  const avgTokens = Math.round(fingerprints.reduce((n, f) => n + f.tokens, 0) / fingerprints.length);
  core.info(`  Generated ${fingerprints.length} fingerprints (avg ${avgTokens} tokens/file, ${totalHotspots} hotspots)`);

  // Pack into token-budgeted chunks
  const chunks = packFingerprints(fingerprints, model);
  core.info(`  Packed into ${chunks.length} fingerprint chunks`);
  core.info('');

  const allIssues: Issue[] = [];
  let totalTokens = 0;
  let apiCalls = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunkStart = Date.now();
    const fileCount = chunks[i].fingerprints.length;
    const progress = Math.round(((i + 1) / chunks.length) * 100);
    core.info(`  [${i + 1}/${chunks.length}] (${progress}%) Fingerprint scan: ${fileCount} files (~${chunks[i].totalTokens} tokens)`);

    try {
      const systemMsg = customPrompt
        ? `You are a code quality analyzer. Report only real issues with exact file paths and line numbers.\n\n${customPrompt}`
        : 'You are a code quality analyzer. Report only real issues with exact file paths and line numbers.';
      const { content, tokens } = await callGitHubModels(
        [
          { role: 'system', content: systemMsg },
          { role: 'user', content: chunks[i].promptText },
        ],
        model,
        { responseFormat: ISSUES_SCHEMA },
      );
      totalTokens += tokens;
      apiCalls++;
      const chunkIssues = parseIssues(content);
      allIssues.push(...chunkIssues);

      const elapsed = formatDuration(Date.now() - chunkStart);
      if (chunkIssues.length > 0) {
        core.info(`         Found ${chunkIssues.length} issues (${tokens} tokens, ${elapsed})`);
      } else {
        core.info(`         Clean (${tokens} tokens, ${elapsed})`);
      }
    } catch (e) {
      core.warning(`         FAILED: ${e}`);
    }

    if (i < chunks.length - 1) {
      await sleep(4500);
    }
  }

  return { issues: allIssues, tokens: totalTokens, apiCalls };
}

// ---------------------------------------------------------------------------
// Layer 2: Deep scan with full content (kept as fallback, used for smart-split)
// ---------------------------------------------------------------------------

async function scanChunk(
  chunk: SmartChunk,
  chunkNum: number,
  totalChunks: number,
  model: string,
  depth: number = 0,
  customPrompt?: string,
): Promise<{ issues: Issue[]; tokens: number }> {
  const prompt = buildSmartPrompt(chunk, chunkNum, totalChunks);
  const systemMsg = customPrompt
    ? `You are a code quality analyzer. Report only real issues with exact file paths and line numbers.\n\n${customPrompt}`
    : 'You are a code quality analyzer. Report only real issues with exact file paths and line numbers.';

  try {
    const { content, tokens } = await callGitHubModels(
      [
        { role: 'system', content: systemMsg },
        { role: 'user', content: prompt },
      ],
      model,
      { responseFormat: ISSUES_SCHEMA },
    );
    return { issues: parseIssues(content), tokens };
  } catch (e) {
    if (!(e instanceof TokenLimitError) || depth >= 2) throw e;

    core.info(`       Token limit hit — auto-splitting chunk and compressing (depth ${depth + 1})`);

    const modelLimit = getModelInputLimit(model);
    const halfBudget = Math.floor(calculateCodeBudget(modelLimit) * 0.45);

    const mid = Math.ceil(chunk.files.length / 2);
    const halves = [chunk.files.slice(0, mid), chunk.files.slice(mid)];
    const allIssues: Issue[] = [];
    let allTokens = 0;

    for (const half of halves) {
      if (half.length === 0) continue;

      const perFileBudget = Math.floor(halfBudget / half.length);
      for (const f of half) {
        if (f.content.length > perFileBudget) {
          const ext = path.extname(f.relativePath).toLowerCase();
          const result = compressFile(f.content, ext, perFileBudget);
          f.content = result.content;
          f.tokens = estimateTokens(f.content);
          f.compressed = true;
        }
      }

      const subChunk: SmartChunk = {
        files: half,
        totalCodeTokens: half.reduce((s, f) => s + f.tokens, 0),
        manifest: chunk.manifest,
      };

      const result = await scanChunk(subChunk, chunkNum, totalChunks, model, depth + 1, customPrompt);
      allIssues.push(...result.issues);
      allTokens += result.tokens;

      if (halves.indexOf(half) === 0) await sleep(4500);
    }

    return { issues: allIssues, tokens: allTokens };
  }
}

// ---------------------------------------------------------------------------
// Main scan orchestrator: 3-layer pipeline
// ---------------------------------------------------------------------------

export async function runScan(config: SloppyConfig, pluginCtx?: PluginContext): Promise<ScanResult> {
  const cwd = process.env.GITHUB_WORKSPACE || process.cwd();
  const scanStart = Date.now();

  const scope = config.scanScope;
  const isPR = !!github.context.payload.pull_request;
  const usePrDiff = scope === 'pr' || (scope === 'auto' && isPR);

  core.info('');
  core.info('='.repeat(50));
  core.info('SLOPPY FREE SCAN');
  core.info(`Model: ${config.githubModelsModel}`);
  core.info(`Scope: ${scope}${scope === 'auto' ? (isPR ? ' → pr' : ' → full') : ''}`);
  core.info('='.repeat(50));
  core.info('');

  let files: string[];
  let scopeLabel: string;

  if (usePrDiff) {
    core.info('Collecting PR changed files...');
    const prFiles = await collectPrFiles(cwd);
    if (prFiles && prFiles.length > 0) {
      files = prFiles;
      scopeLabel = `PR #${github.context.payload.pull_request?.number} (${files.length} changed files)`;
    } else {
      core.info('No PR files found or not in PR context. Falling back to full repo scan.');
      files = collectFiles(cwd);
      scopeLabel = `full repo (${files.length} files)`;
    }
  } else {
    core.info('Collecting all source files...');
    files = collectFiles(cwd);
    scopeLabel = `full repo (${files.length} files)`;
  }

  core.info(`Scope: ${scopeLabel}`);

  if (files.length === 0) {
    core.info('No source files found — nothing to scan.');
    return { issues: [], score: 100, summary: 'No source files found.', tokens: 0 };
  }

  // Log file type breakdown
  const extCounts: Record<string, number> = {};
  for (const f of files) {
    const ext = path.extname(f).toLowerCase();
    extCounts[ext] = (extCounts[ext] || 0) + 1;
  }
  const topExts = Object.entries(extCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([ext, count]) => `${ext}(${count})`)
    .join(', ');
  core.info(`File types: ${topExts}`);

  // ================================================================
  // CACHE: Skip unchanged files
  // ================================================================
  // Strategy is decided by total file count so cache keys stay stable
  // across runs. Deep-scan entries satisfy any request; fingerprint
  // entries only satisfy fingerprint requests.
  const DEEP_SCAN_THRESHOLD = 15;
  const scanStrategy: ScanStrategy = files.length <= DEEP_SCAN_THRESHOLD ? 'deep' : 'fingerprint';
  const { cachedIssues, uncachedFiles, cacheHits, cache } = partitionByCache(
    files, cwd, config.githubModelsModel, scanStrategy,
  );

  if (cacheHits > 0) {
    core.info(`Cache: ${cacheHits} files unchanged (${cachedIssues.length} cached issues), ${uncachedFiles.length} files to scan`);
  }

  const filesToScan = uncachedFiles;
  const allIssues: Issue[] = [...cachedIssues];
  let totalTokens = 0;
  let totalApiCalls = 0;

  if (filesToScan.length === 0) {
    core.info('All files cached — no API calls needed!');
  } else {
    // ================================================================
    // LAYER 0: Local static analysis (zero API calls)
    // ================================================================
    core.info('');
    core.info('── Layer 0: Local Analysis (no API calls) ──');
    const extraPatterns = pluginCtx?.extraPatterns || [];
    const { issues: localIssues, flaggedFiles } = localScanAll(filesToScan, cwd, extraPatterns);
    if (localIssues.length > 0) {
      core.info(`  Found ${localIssues.length} issues locally (${flaggedFiles.size} files flagged)`);
      allIssues.push(...localIssues);
    } else {
      core.info('  No local issues found');
    }

    // ================================================================
    // LAYER 1: AI scan — strategy depends on file count
    //
    // PR / small sets (≤15 files): deep scan with full file contents.
    //   Accuracy matters more than speed when the set is small, and
    //   full content fits in a handful of API calls anyway.
    //
    // Full repo / large sets (>15 files): fingerprint scan.
    //   Compact representations (~100 tokens/file) let us pack 20+
    //   files per request, cutting 33 API calls to 3-5.
    // ================================================================
    const useDeepScan = scanStrategy === 'deep';
    let aiIssues: Issue[] = [];

    // Run pre-scan hooks
    if (pluginCtx) await runHook(pluginCtx.plugins, 'pre-scan');

    const customPrompt = pluginCtx?.customPrompt || '';

    if (useDeepScan) {
      core.info('');
      core.info(`── Layer 1: Deep Scan (${filesToScan.length} files — full content) ──`);

      const modelLimit = getModelInputLimit(config.githubModelsModel);
      const codeBudget = calculateCodeBudget(modelLimit);
      const chunks = prepareChunks(filesToScan, cwd, config.githubModelsModel);

      const compressedCount = chunks.reduce(
        (n, c) => n + c.files.filter(f => f.compressed).length, 0,
      );
      core.info(`  ${chunks.length} chunks (budget: ~${Math.round(codeBudget / 1024)}KB/chunk, ${compressedCount} files compressed)`);
      core.info('');

      for (let i = 0; i < chunks.length; i++) {
        const chunkStart = Date.now();
        const chunkFileNames = chunks[i].files.map(f => f.relativePath);
        const progress = Math.round(((i + 1) / chunks.length) * 100);
        const compressedInChunk = chunks[i].files.filter(f => f.compressed).length;
        const compressedLabel = compressedInChunk > 0 ? ` [${compressedInChunk} compressed]` : '';
        core.info(`  [${i + 1}/${chunks.length}] (${progress}%) Scanning: ${chunkFileNames.slice(0, 3).join(', ')}${chunkFileNames.length > 3 ? ` +${chunkFileNames.length - 3} more` : ''}${compressedLabel}`);

        try {
          const { issues: chunkIssues, tokens } = await scanChunk(
            chunks[i], i + 1, chunks.length, config.githubModelsModel, 0, customPrompt || undefined,
          );
          totalTokens += tokens;
          totalApiCalls++;
          aiIssues.push(...chunkIssues);

          const elapsed = formatDuration(Date.now() - chunkStart);
          if (chunkIssues.length > 0) {
            core.info(`         Found ${chunkIssues.length} issues (${tokens} tokens, ${elapsed})`);
          } else {
            core.info(`         Clean (${tokens} tokens, ${elapsed})`);
          }
        } catch (e) {
          core.warning(`         FAILED: ${e}`);
        }

        if (i < chunks.length - 1) await sleep(4500);
      }
    } else {
      core.info('');
      core.info(`── Layer 1: Fingerprint Scan (${filesToScan.length} files — compact) ──`);
      const fpResult = await runFingerprintScan(filesToScan, cwd, config.githubModelsModel, customPrompt || undefined);
      aiIssues = fpResult.issues;
      totalTokens += fpResult.tokens;
      totalApiCalls += fpResult.apiCalls;
    }

    allIssues.push(...aiIssues);

    // Run post-scan hooks
    if (pluginCtx) await runHook(pluginCtx.plugins, 'post-scan');

    // Update cache with new results
    const newIssues = [...localIssues, ...aiIssues];
    updateCacheEntries(cache, newIssues, filesToScan, cwd, scanStrategy);
    saveCache(cwd, cache);
  }

  // ================================================================
  // Apply plugin filters
  // ================================================================
  if (pluginCtx) {
    const before = allIssues.length;
    const filtered = applyFilters(allIssues, pluginCtx.filters);
    if (filtered.length < before) {
      core.info(`Plugin filters removed ${before - filtered.length} issues`);
    }
    allIssues.length = 0;
    allIssues.push(...filtered);
  }

  // ================================================================
  // Deduplicate & score
  // ================================================================
  const seen = new Set<string>();
  const unique = allIssues.filter(issue => {
    const key = `${issue.file}:${issue.line}:${issue.type}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const score = calculateScore(unique);
  const totalElapsed = formatDuration(Date.now() - scanStart);

  // Summary
  core.info('');
  core.info('='.repeat(50));
  core.info('SCAN COMPLETE');
  core.info('='.repeat(50));
  core.info(`Score:      ${score}/100`);
  core.info(`Issues:     ${unique.length} found`);
  core.info(`API calls:  ${totalApiCalls} (was ${Math.ceil(files.length / 2.3)} with old chunking)`);
  core.info(`Cache hits: ${cacheHits}/${files.length} files`);
  core.info(`Tokens:     ${totalTokens.toLocaleString()}`);
  core.info(`Duration:   ${totalElapsed}`);

  if (unique.length > 0) {
    core.info('');
    core.info('Issue breakdown:');
    const byType: Record<string, number> = {};
    const bySev: Record<string, number> = {};
    for (const issue of unique) {
      byType[issue.type] = (byType[issue.type] || 0) + 1;
      bySev[issue.severity] = (bySev[issue.severity] || 0) + 1;
    }
    for (const [sev, count] of Object.entries(bySev).sort()) {
      core.info(`  ${sev}: ${count}`);
    }
    core.info('');
    for (const [type, count] of Object.entries(byType).sort()) {
      core.info(`  ${type}: ${count}`);
    }
  }
  core.info('='.repeat(50));

  const summary = `Found ${unique.length} issues across ${files.length} files. Score: ${score}/100.`;
  return { issues: unique, score, summary, tokens: totalTokens };
}
