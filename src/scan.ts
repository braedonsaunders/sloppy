import * as core from '@actions/core';
import * as fs from 'fs';
import * as path from 'path';
import * as github from '@actions/github';
import { callGitHubModels, TokenLimitError } from './github-models';
import { SloppyConfig, Issue, ScanResult, IssueType, Severity } from './types';
import {
  prepareChunks,
  buildSmartPrompt,
  compressFile,
  estimateTokens,
  getModelInputLimit,
  calculateCodeBudget,
  SmartChunk,
} from './smart-split';

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
// No more "please respond with valid JSON" in the prompt.
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

    // Paginate — PRs can touch hundreds of files
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
    // Fallback: try to extract JSON from mixed content (shouldn't happen with structured outputs)
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

/**
 * Scan a single chunk, with automatic retry on 413 (token limit exceeded).
 *
 * On 413, the chunk is split in half and each half is retried independently.
 * Files in the oversized half are further compressed before retrying.
 * This provides resilience against token estimation inaccuracies.
 */
async function scanChunk(
  chunk: SmartChunk,
  chunkNum: number,
  totalChunks: number,
  model: string,
  depth: number = 0,
): Promise<{ issues: Issue[]; tokens: number }> {
  const prompt = buildSmartPrompt(chunk, chunkNum, totalChunks);

  try {
    const { content, tokens } = await callGitHubModels(
      [
        { role: 'system', content: 'You are a code quality analyzer. Report only real issues with exact file paths and line numbers.' },
        { role: 'user', content: prompt },
      ],
      model,
      { responseFormat: ISSUES_SCHEMA },
    );
    return { issues: parseIssues(content), tokens };
  } catch (e) {
    if (!(e instanceof TokenLimitError) || depth >= 2) throw e;

    // 413 recovery: split the chunk and compress files further.
    core.info(`       Token limit hit — auto-splitting chunk and compressing (depth ${depth + 1})`);

    const modelLimit = getModelInputLimit(model);
    const halfBudget = Math.floor(calculateCodeBudget(modelLimit) * 0.45); // 45% each half for safety

    const mid = Math.ceil(chunk.files.length / 2);
    const halves = [chunk.files.slice(0, mid), chunk.files.slice(mid)];
    let allIssues: Issue[] = [];
    let allTokens = 0;

    for (const half of halves) {
      if (half.length === 0) continue;

      // Compress each file to fit the reduced budget
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

      const result = await scanChunk(subChunk, chunkNum, totalChunks, model, depth + 1);
      allIssues.push(...result.issues);
      allTokens += result.tokens;

      if (halves.indexOf(half) === 0) await sleep(4500);
    }

    return { issues: allIssues, tokens: allTokens };
  }
}

export async function runScan(config: SloppyConfig): Promise<ScanResult> {
  const cwd = process.env.GITHUB_WORKSPACE || process.cwd();
  const scanStart = Date.now();

  // Determine scan scope early so we can log it
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

  // Smart chunking: token-aware, dependency-grouped, with compression + manifest
  const modelLimit = getModelInputLimit(config.githubModelsModel);
  const codeBudget = calculateCodeBudget(modelLimit);
  const chunks = prepareChunks(files, cwd, config.githubModelsModel);

  const compressedCount = chunks.reduce(
    (n, c) => n + c.files.filter(f => f.compressed).length, 0,
  );
  core.info(`Split into ${chunks.length} chunks (budget: ~${Math.round(codeBudget / 1024)}KB/chunk, ${compressedCount} files compressed)`);
  core.info('');

  const allIssues: Issue[] = [];
  let totalTokens = 0;
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunkStart = Date.now();
    const chunkFileNames = chunks[i].files.map(f => f.relativePath);
    const progress = Math.round(((i + 1) / chunks.length) * 100);
    const compressedInChunk = chunks[i].files.filter(f => f.compressed).length;
    const compressedLabel = compressedInChunk > 0 ? ` [${compressedInChunk} compressed]` : '';
    core.info(`[${i + 1}/${chunks.length}] (${progress}%) Scanning: ${chunkFileNames.slice(0, 3).join(', ')}${chunkFileNames.length > 3 ? ` +${chunkFileNames.length - 3} more` : ''}${compressedLabel}`);

    try {
      const { issues: chunkIssues, tokens } = await scanChunk(
        chunks[i], i + 1, chunks.length, config.githubModelsModel,
      );
      totalTokens += tokens;
      allIssues.push(...chunkIssues);
      successCount++;

      const elapsed = formatDuration(Date.now() - chunkStart);
      if (chunkIssues.length > 0) {
        core.info(`       Found ${chunkIssues.length} issues (${tokens} tokens, ${elapsed})`);
      } else {
        core.info(`       Clean (${tokens} tokens, ${elapsed})`);
      }
    } catch (e) {
      failCount++;
      core.warning(`       FAILED: ${e}`);
    }

    // Space out requests to stay under RPM limits.
    // Low tier (gpt-4o-mini): 15 RPM = 1 req/4s. High tier (gpt-4o): 10 RPM = 1 req/6s.
    // The retry logic in github-models.ts handles 429s, but spacing prevents them.
    if (i < chunks.length - 1) {
      await sleep(4500);
    }
  }

  // Deduplicate
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
  core.info(`Score:    ${score}/100`);
  core.info(`Issues:   ${unique.length} found`);
  core.info(`Chunks:   ${successCount} ok, ${failCount} failed`);
  core.info(`Tokens:   ${totalTokens.toLocaleString()}`);
  core.info(`Duration: ${totalElapsed}`);

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
