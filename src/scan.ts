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
import { runHook, applyFilters, applyAllowRules, formatCustomPromptSection } from './plugins';
import { generateFingerprint, packFingerprints, FingerprintChunk } from './fingerprint';
import { partitionByCache, updateCacheEntries, saveCache, ScanStrategy } from './scan-cache';
import * as ui from './ui';
import { formatDuration, sleep, mapRawToIssue } from './utils';

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.py', '.rb', '.go', '.rs', '.java',
  '.c', '.cpp', '.h', '.hpp', '.cs', '.php', '.swift', '.kt', '.scala',
  '.vue', '.svelte', '.html', '.css', '.scss', '.sql', '.sh', '.yaml',
  '.yml', '.json', '.toml', '.xml', '.dockerfile',
]);

/** Files without extensions that contain executable code. */
const CODE_FILENAMES = new Set([
  'Dockerfile', 'Makefile', 'Rakefile', 'Gemfile', 'Procfile',
  'Vagrantfile', 'Jenkinsfile', 'Brewfile',
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

export function collectFiles(dir: string, files: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.github') continue;
    if (IGNORE_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(full, files);
    } else if (CODE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()) || CODE_FILENAMES.has(entry.name)) {
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
    const rawIssues: unknown[] = data.issues || [];
    const issues: Issue[] = [];
    for (let i = 0; i < rawIssues.length; i++) {
      const issue = mapRawToIssue(rawIssues[i], 'scan', i);
      if (issue) issues.push(issue);
    }
    return issues;
  } catch {
    try {
      const match = content.match(/\{[\s\S]*\}/);
      if (!match) return [];
      const data = JSON.parse(match[0]);
      const rawIssues: unknown[] = data.issues || [];
      const issues: Issue[] = [];
      for (let i = 0; i < rawIssues.length; i++) {
        const issue = mapRawToIssue(rawIssues[i], 'scan', i);
        if (issue) issues.push(issue);
      }
      return issues;
    } catch {
      core.warning('Failed to parse scan response');
      return [];
    }
  }
}

/**
 * Count non-blank lines of code across the given files.
 * Returns at least 1 to avoid division-by-zero.
 */
export function countSourceLOC(files: string[]): number {
  let loc = 0;
  for (const f of files) {
    try {
      const content = fs.readFileSync(f, 'utf-8');
      loc += content.split('\n').filter(l => l.trim().length > 0).length;
    } catch {}
  }
  return Math.max(loc, 1);
}

/**
 * Score code quality 0–100. When `loc` is provided the penalty is
 * normalised per-KLOC so larger repos aren't unfairly punished.
 */
export function calculateScore(issues: Issue[], loc?: number): number {
  const penalties: Record<Severity, number> = { critical: 10, high: 5, medium: 2, low: 1 };
  let totalPenalty = 0;
  for (const issue of issues) {
    totalPenalty += penalties[issue.severity] || 1;
  }
  if (loc && loc > 0) {
    const kloc = Math.max(1, loc / 1000);
    totalPenalty = totalPenalty / kloc;
  }
  return Math.max(0, Math.min(100, Math.round(100 - totalPenalty)));
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
  core.info(`  ${fingerprints.length} fingerprints ${ui.c(`(avg ${avgTokens} tokens, ${totalHotspots} hotspots)`, ui.S.gray)}`);

  // Pack into token-budgeted chunks
  const chunks = packFingerprints(fingerprints, model);
  core.info(`  ${chunks.length} chunks to scan`);

  const allIssues: Issue[] = [];
  let totalTokens = 0;
  let apiCalls = 0;

  const CONCURRENCY = 3; // Fire up to 3 API calls simultaneously
  const systemMsg = customPrompt
    ? `You are a code quality analyzer. Report only real issues with exact file paths and line numbers.\n\n${customPrompt}`
    : 'You are a code quality analyzer. Report only real issues with exact file paths and line numbers.';

  // Process chunks in concurrent batches
  for (let batchStart = 0; batchStart < chunks.length; batchStart += CONCURRENCY) {
    const batch = chunks.slice(batchStart, batchStart + CONCURRENCY);
    const batchStartTime = Date.now();

    // Log what we're dispatching
    for (let j = 0; j < batch.length; j++) {
      const idx = batchStart + j;
      const fileCount = batch[j].fingerprints.length;
      core.info(ui.progressBar(idx + 1, chunks.length, 20, `${fileCount} files (~${batch[j].totalTokens} tokens)`));
    }

    // Fire all requests in this batch concurrently
    const results = await Promise.allSettled(
      batch.map(async (chunk, j) => {
        const idx = batchStart + j;
        // Stagger starts slightly to avoid hitting rate limits simultaneously
        if (j > 0) await sleep(500 * j);
        const chunkStart = Date.now();
        const { content, tokens } = await callGitHubModels(
          [
            { role: 'system', content: systemMsg },
            { role: 'user', content: chunk.promptText },
          ],
          model,
          { responseFormat: ISSUES_SCHEMA },
        );
        return { content, tokens, idx, elapsed: Date.now() - chunkStart };
      }),
    );

    // Collect results
    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      if (r.status === 'fulfilled') {
        const { content, tokens, elapsed } = r.value;
        totalTokens += tokens;
        apiCalls++;
        const chunkIssues = parseIssues(content);
        allIssues.push(...chunkIssues);

        const elapsedStr = formatDuration(elapsed);
        if (chunkIssues.length > 0) {
          core.info(`    ${ui.c(ui.SYM.bullet, ui.S.yellow)} Found ${ui.c(String(chunkIssues.length), ui.S.bold)} issues ${ui.c(`(${tokens} tokens, ${elapsedStr})`, ui.S.gray)}`);
        } else {
          core.info(`    ${ui.c(ui.SYM.check, ui.S.green)} Clean ${ui.c(`(${tokens} tokens, ${elapsedStr})`, ui.S.gray)}`);
        }
      } else {
        core.warning(`    FAILED: ${r.reason}`);
      }
    }

    // Rate-limit pause between batches (not after last batch)
    if (batchStart + CONCURRENCY < chunks.length) {
      await sleep(3000);
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

  ui.section('SCAN');
  ui.kv('Model', config.githubModelsModel);
  ui.kv('Scope', `${scope}${scope === 'auto' ? (isPR ? ' \u2192 pr' : ' \u2192 full') : ''}`);

  let files: string[];
  let scopeLabel: string;

  if (usePrDiff) {
    core.info(`  Collecting PR changed files...`);
    const prFiles = await collectPrFiles(cwd);
    if (prFiles && prFiles.length > 0) {
      files = prFiles;
      scopeLabel = `PR #${github.context.payload.pull_request?.number} (${files.length} changed files)`;
    } else {
      core.info(`  No PR files found. Falling back to full repo scan.`);
      files = collectFiles(cwd);
      scopeLabel = `full repo (${files.length} files)`;
    }
  } else {
    core.info(`  Collecting source files...`);
    files = collectFiles(cwd);
    scopeLabel = `full repo (${files.length} files)`;
  }

  ui.kv('Files', scopeLabel);

  if (files.length === 0) {
    core.info(`  ${ui.c('No source files found', ui.S.gray)} — nothing to scan.`);
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
  ui.kv('File types', topExts);

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
    ui.kv('Cache', `${cacheHits} files cached, ${uncachedFiles.length} to scan`);
  }

  const filesToScan = uncachedFiles;
  const allIssues: Issue[] = [...cachedIssues];
  let totalTokens = 0;
  let totalApiCalls = 0;

  if (filesToScan.length === 0) {
    core.info(`  ${ui.c(ui.SYM.check, ui.S.green)} All files cached — no API calls needed`);
  } else {
    // ================================================================
    // LAYER 0: Local static analysis (zero API calls)
    // ================================================================
    ui.section('Layer 0: Local Analysis');
    const extraPatterns = pluginCtx?.extraPatterns || [];
    const { issues: localIssues, flaggedFiles } = localScanAll(filesToScan, cwd, extraPatterns);
    if (localIssues.length > 0) {
      core.info(`  Found ${ui.c(String(localIssues.length), ui.S.bold)} issues locally ${ui.c(`(${flaggedFiles.size} files)`, ui.S.gray)}`);
      allIssues.push(...localIssues);
    } else {
      core.info(`  ${ui.c(ui.SYM.check, ui.S.green)} No local issues found`);
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

    const customPrompt = pluginCtx ? formatCustomPromptSection(pluginCtx, config) : '';

    if (useDeepScan) {
      ui.section(`Layer 1: Deep Scan (${filesToScan.length} files)`);

      const modelLimit = getModelInputLimit(config.githubModelsModel);
      const codeBudget = calculateCodeBudget(modelLimit);
      const chunks = prepareChunks(filesToScan, cwd, config.githubModelsModel);

      const compressedCount = chunks.reduce(
        (n, c) => n + c.files.filter(f => f.compressed).length, 0,
      );
      core.info(`  ${chunks.length} chunks, ~${Math.round(codeBudget / 1024)}KB/chunk${compressedCount > 0 ? `, ${compressedCount} compressed` : ''}`);

      const DEEP_CONCURRENCY = 3;
      for (let batchStart = 0; batchStart < chunks.length; batchStart += DEEP_CONCURRENCY) {
        const batch = chunks.slice(batchStart, batchStart + DEEP_CONCURRENCY);

        for (let j = 0; j < batch.length; j++) {
          const idx = batchStart + j;
          const chunkFileNames = batch[j].files.map(f => f.relativePath);
          const compressedInChunk = batch[j].files.filter(f => f.compressed).length;
          const compressedLabel = compressedInChunk > 0 ? ` [${compressedInChunk} compressed]` : '';
          core.info(ui.progressBar(idx + 1, chunks.length, 20, `${chunkFileNames.slice(0, 3).join(', ')}${chunkFileNames.length > 3 ? ` +${chunkFileNames.length - 3}` : ''}${compressedLabel}`));
        }

        const results = await Promise.allSettled(
          batch.map(async (chunk, j) => {
            const idx = batchStart + j;
            if (j > 0) await sleep(500 * j);
            const chunkStart = Date.now();
            const { issues: chunkIssues, tokens } = await scanChunk(
              chunk, idx + 1, chunks.length, config.githubModelsModel, 0, customPrompt || undefined,
            );
            return { chunkIssues, tokens, elapsed: Date.now() - chunkStart };
          }),
        );

        for (const r of results) {
          if (r.status === 'fulfilled') {
            const { chunkIssues, tokens, elapsed } = r.value;
            totalTokens += tokens;
            totalApiCalls++;
            aiIssues.push(...chunkIssues);
            const elapsedStr = formatDuration(elapsed);
            if (chunkIssues.length > 0) {
              core.info(`    ${ui.c(ui.SYM.bullet, ui.S.yellow)} Found ${ui.c(String(chunkIssues.length), ui.S.bold)} issues ${ui.c(`(${tokens} tokens, ${elapsedStr})`, ui.S.gray)}`);
            } else {
              core.info(`    ${ui.c(ui.SYM.check, ui.S.green)} Clean ${ui.c(`(${tokens} tokens, ${elapsedStr})`, ui.S.gray)}`);
            }
          } else {
            core.warning(`         FAILED: ${r.reason}`);
          }
        }

        if (batchStart + DEEP_CONCURRENCY < chunks.length) {
          await sleep(3000);
        }
      }
    } else {
      ui.section(`Layer 1: Fingerprint Scan (${filesToScan.length} files)`);
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
  // Apply min-severity filter
  // ================================================================
  if (config.minSeverity !== 'low') {
    const SRANK: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };
    const minRank = SRANK[config.minSeverity] ?? 0;
    const before = allIssues.length;
    const sevFiltered = allIssues.filter(i => (SRANK[i.severity] ?? 0) >= minRank);
    if (sevFiltered.length < before) {
      core.info(`min-severity filter (${config.minSeverity}+) removed ${before - sevFiltered.length} issues`);
    }
    allIssues.length = 0;
    allIssues.push(...sevFiltered);
  }

  // ================================================================
  // Apply allow-list (false positive suppressions)
  // ================================================================
  if (config.allow.length > 0) {
    const before = allIssues.length;
    const allowFiltered = applyAllowRules(allIssues, config.allow);
    if (allowFiltered.length < before) {
      core.info(`Allow-list suppressed ${before - allowFiltered.length} issues`);
    }
    allIssues.length = 0;
    allIssues.push(...allowFiltered);
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

  const loc = countSourceLOC(files);
  const score = calculateScore(unique, loc);
  const totalElapsed = formatDuration(Date.now() - scanStart);

  // Summary
  ui.blank();
  ui.banner('SCAN COMPLETE');
  ui.score(score, `Score`);
  ui.stat('LOC', loc.toLocaleString());
  ui.stat('Issues', `${unique.length} found`);
  ui.stat('API calls', String(totalApiCalls));
  ui.stat('Cache', `${cacheHits}/${files.length} files`);
  ui.stat('Tokens', totalTokens.toLocaleString());
  ui.stat('Duration', totalElapsed);

  if (unique.length > 0) {
    ui.blank();
    const bySev: Record<string, number> = {};
    const byType: Record<string, number> = {};
    for (const issue of unique) {
      byType[issue.type] = (byType[issue.type] || 0) + 1;
      bySev[issue.severity] = (bySev[issue.severity] || 0) + 1;
    }
    ui.severityBreakdown(bySev);
    ui.blank();
    const typeSummary = Object.entries(byType)
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => `${type}(${count})`)
      .join('  ');
    core.info(`  ${ui.c(typeSummary, ui.S.gray)}`);
  }
  core.info(ui.divider());

  const summary = `Found ${unique.length} issues across ${files.length} files. Score: ${score}/100.`;
  return { issues: unique, score, summary, tokens: totalTokens };
}
