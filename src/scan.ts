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
import { ScanBudget, getModelTier } from './scan-budget';
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
// Includes evidence and line_content fields for post-scan verification.
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
              evidence: { type: 'string' },
              line_content: { type: 'string' },
            },
            required: ['type', 'severity', 'file', 'line', 'description', 'evidence', 'line_content'],
            additionalProperties: false,
          },
        },
      },
      required: ['issues'],
      additionalProperties: false,
    },
  },
};

const VERIFICATION_SCHEMA = {
  type: 'json_schema' as const,
  json_schema: {
    name: 'verification_results',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        results: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              index: { type: 'number' },
              is_real: { type: 'boolean' },
              reason: { type: 'string' },
            },
            required: ['index', 'is_real', 'reason'],
            additionalProperties: false,
          },
        },
      },
      required: ['results'],
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
// Post-scan verification — catch AI hallucinations without API calls
// ---------------------------------------------------------------------------

/**
 * Check whether a security claim has supporting evidence in the actual file.
 * Used for high-severity security issues that lack verifiable line_content
 * (common in fingerprint scans where the AI sees signatures, not code).
 *
 * Searches ±15 lines around the reported line for patterns matching the claim.
 * Returns true if evidence is found, false if the claim appears hallucinated.
 */
function verifySecurityEvidence(issue: Issue, fullPath: string): boolean {
  try {
    const content = fs.readFileSync(fullPath, 'utf-8');
    const lines = content.split('\n');
    const searchStart = Math.max(0, (issue.line || 1) - 16);
    const searchEnd = Math.min(lines.length, (issue.line || 1) + 15);
    const region = lines.slice(searchStart, searchEnd).join('\n');

    // If evidence field is substantial, check if it exists in the region or full file
    if (issue.evidence && issue.evidence.trim().length > 15) {
      const evidenceNorm = issue.evidence.trim().toLowerCase().replace(/\s+/g, ' ');
      const regionNorm = region.toLowerCase().replace(/\s+/g, ' ');
      if (regionNorm.includes(evidenceNorm)) return true;
      // Also search the full file (AI line numbers can be way off)
      if (content.toLowerCase().replace(/\s+/g, ' ').includes(evidenceNorm)) return true;
    }

    // Pattern-match: check if the claimed security issue type has a basis in the code
    const desc = issue.description.toLowerCase();

    // Hardcoded secrets/passwords
    if (desc.includes('hardcoded') || desc.includes('password') || desc.includes('secret') || desc.includes('api key') || desc.includes('credential')) {
      return /(?:password|passwd|secret|api_key|apikey|auth_token|credential)\s*[=:]\s*['"][^'"]{4,}/i.test(region);
    }

    // XSS / innerHTML
    if (desc.includes('xss') || desc.includes('cross-site') || desc.includes('innerhtml')) {
      return /(?:\.innerHTML\s*=|dangerouslySetInnerHTML|document\.write\s*\()/i.test(region);
    }

    // SQL injection
    if (desc.includes('sql') && desc.includes('injection')) {
      return /(?:SELECT|INSERT|UPDATE|DELETE|DROP)\b/i.test(region) && /(?:\$\{|%s|\+\s*['"])/i.test(region);
    }

    // Logging sensitive data
    if (desc.includes('log') && (desc.includes('sensitive') || desc.includes('password') || desc.includes('token') || desc.includes('secret'))) {
      const hasLogging = /(?:console\.log|console\.info|console\.debug|logger\.\w+|log\.\w+|print\s*\()/i.test(region);
      const hasSensitive = /(?:password|token|secret|credential|api_key|private_key)/i.test(region);
      return hasLogging && hasSensitive;
    }

    // Command/shell injection
    if (desc.includes('command injection') || desc.includes('shell injection')) {
      return /(?:exec\s*\(|spawn\s*\(|system\s*\(|os\.system|subprocess)/i.test(region);
    }

    // Generic: no specific pattern recognized — reject unverifiable security claims
    return false;
  } catch {
    // File read failed — be conservative, allow it through
    return true;
  }
}

/**
 * Verify AI-reported issues against actual file contents.
 * Discards issues where:
 *   1. The file doesn't exist
 *   2. The reported line_content doesn't match anything near the reported line
 *   3. The issue duplicates something already caught locally
 *   4. High-severity security issues lack verifiable evidence in the actual file
 *
 * This is a zero-cost safety net (file reads only, no API calls).
 */
function verifyIssues(
  aiIssues: Issue[],
  localIssues: Issue[],
  cwd: string,
): { verified: Issue[]; rejected: Issue[] } {
  const verified: Issue[] = [];
  const rejected: Issue[] = [];

  // Build a set of local issue keys for dedup
  const localKeys = new Set(
    localIssues.map(i => `${i.file}:${i.line}:${i.type}`),
  );

  for (const issue of aiIssues) {
    // 1. Skip issues that duplicate local findings
    const key = `${issue.file}:${issue.line}:${issue.type}`;
    if (localKeys.has(key)) {
      rejected.push(issue);
      continue;
    }

    // Also check nearby lines (±3) for the same type — AI line numbers can be off by a few
    if (issue.line) {
      let isDupNearby = false;
      for (let offset = -3; offset <= 3; offset++) {
        const nearKey = `${issue.file}:${(issue.line || 0) + offset}:${issue.type}`;
        if (localKeys.has(nearKey)) {
          isDupNearby = true;
          break;
        }
      }
      if (isDupNearby) {
        rejected.push(issue);
        continue;
      }
    }

    // 2. Verify file exists
    const fullPath = path.join(cwd, issue.file);
    if (!fs.existsSync(fullPath)) {
      rejected.push(issue);
      continue;
    }

    // 3. If AI provided line_content, verify it matches the actual file
    let contentVerified = false;
    if (issue.lineContent && issue.line) {
      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const lines = content.split('\n');

        // Check ±5 lines around the reported line for the claimed content
        const searchStart = Math.max(0, issue.line - 6);
        const searchEnd = Math.min(lines.length, issue.line + 5);

        // Normalize for comparison: trim and collapse whitespace
        const normalize = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
        const claimedNorm = normalize(issue.lineContent);

        // Only verify if the AI gave us something substantial (>10 chars)
        if (claimedNorm.length > 10) {
          for (let j = searchStart; j < searchEnd; j++) {
            const actualNorm = normalize(lines[j] || '');
            // Fuzzy match: claimed content is a substring of actual or vice versa
            if (actualNorm.includes(claimedNorm) || claimedNorm.includes(actualNorm)) {
              contentVerified = true;
              // Correct the line number to the actual match
              if (j + 1 !== issue.line) {
                issue.line = j + 1;
              }
              break;
            }
          }

          if (!contentVerified) {
            rejected.push(issue);
            continue;
          }
        }
      } catch {
        // File read failed — don't reject, just pass through
      }
    }

    // 4. For high-severity security issues not verified by line_content,
    //    require evidence-based verification against actual file contents.
    //    This catches AI hallucinations from fingerprint scans where the AI
    //    sees signatures but not code, and invents security issues.
    if (!contentVerified && issue.type === 'security' &&
        (issue.severity === 'high' || issue.severity === 'critical')) {
      if (!verifySecurityEvidence(issue, fullPath)) {
        rejected.push(issue);
        continue;
      }
    }

    verified.push(issue);
  }

  return { verified, rejected };
}

/**
 * AI verification pass: send actual code to a low-tier model to confirm issues.
 * Groups issues into batches, reads ±15 lines of real code around each,
 * and asks the model which issues are genuine.
 * Costs 1 API call per ~8 issues (~500 tokens each).
 */
async function runAIVerificationPass(
  issues: Issue[],
  cwd: string,
  primaryModel: string,
  budget: ScanBudget,
): Promise<Issue[]> {
  if (issues.length === 0) return [];

  const verifyModel = budget.selectModel(primaryModel, 'fingerprint');
  if (budget.remaining(verifyModel) < 1) {
    core.info(`  No API budget for verification — keeping all issues`);
    return issues;
  }

  core.info(`  Verifying ${issues.length} AI issues against actual code...`);

  const BATCH_SIZE = 8;
  const verified: Issue[] = [];

  for (let batchStart = 0; batchStart < issues.length; batchStart += BATCH_SIZE) {
    const batch = issues.slice(batchStart, batchStart + BATCH_SIZE);

    // Build context: actual code around each issue
    const snippets: string[] = [];
    for (let i = 0; i < batch.length; i++) {
      const issue = batch[i];
      const fullPath = path.join(cwd, issue.file);
      let codeContext = '[file not readable]';
      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const fileLines = content.split('\n');
        const start = Math.max(0, (issue.line || 1) - 16);
        const end = Math.min(fileLines.length, (issue.line || 1) + 15);
        codeContext = fileLines
          .slice(start, end)
          .map((l, j) => `${start + j + 1}: ${l}`)
          .join('\n');
      } catch {}

      snippets.push(
        `--- Issue #${i} ---\n` +
        `File: ${issue.file}\n` +
        `Line: ${issue.line}\n` +
        `Type: ${issue.type} (${issue.severity})\n` +
        `Claim: ${issue.description}\n` +
        `Actual code:\n${codeContext}\n`,
      );
    }

    const prompt = `You are verifying code issues. For each issue, the ACTUAL source code is shown. Determine if each is REAL or FALSE POSITIVE.

Key rules:
- A framework decorator providing the return type (FastAPI response_model=, Flask, Django) means it is NOT missing a return type.
- f-strings or template literals in logger/print/error calls are NOT SQL injection.
- Config defaults, placeholder values, or env var fallbacks are NOT hardcoded secrets.
- Input models/schemas accepting secrets is normal — only flag if secrets appear in unmasked output.
- When in doubt, mark FALSE POSITIVE. We prefer missing a real issue over reporting a fake one.

${snippets.join('\n')}
For each issue, respond with its index (0-based within this batch), whether it's real, and a brief reason.`;

    try {
      const model = budget.selectModel(primaryModel, 'fingerprint');
      if (budget.remaining(model) < 1) {
        verified.push(...batch);
        break;
      }

      const { content } = await callGitHubModels(
        [
          { role: 'system', content: 'You verify whether reported code issues are real by examining actual source code. Be strict — reject anything uncertain.' },
          { role: 'user', content: prompt },
        ],
        model,
        { responseFormat: VERIFICATION_SCHEMA },
      );
      budget.recordRequest(model);

      const data = JSON.parse(content);
      const results: Array<{ index: number; is_real: boolean }> = data.results || [];
      const realIndices = new Set(results.filter(r => r.is_real).map(r => r.index));

      for (let j = 0; j < batch.length; j++) {
        if (realIndices.has(j)) {
          verified.push(batch[j]);
        }
      }

      const rejectedCount = batch.length - realIndices.size;
      if (rejectedCount > 0) {
        core.info(`    ${ui.c(String(rejectedCount), ui.S.yellow)} issues rejected by AI verification`);
      }
    } catch (e) {
      core.warning(`  AI verification failed: ${e}. Keeping batch.`);
      verified.push(...batch);
    }

    if (batchStart + BATCH_SIZE < issues.length) {
      await sleep(2000);
    }
  }

  return verified;
}

// ---------------------------------------------------------------------------
// Layer 1: Fingerprint scanning (compact representations → fewer API calls)
// ---------------------------------------------------------------------------

async function runFingerprintScan(
  filePaths: string[],
  cwd: string,
  model: string,
  customPrompt?: string,
  localIssues?: Issue[],
  budget?: ScanBudget,
): Promise<{ issues: Issue[]; tokens: number; apiCalls: number }> {
  // Group local issues by file for annotation injection
  const localByFile = new Map<string, Issue[]>();
  if (localIssues) {
    for (const issue of localIssues) {
      const existing = localByFile.get(issue.file) || [];
      existing.push(issue);
      localByFile.set(issue.file, existing);
    }
  }

  // Generate fingerprints with local issue annotations
  const fingerprints = filePaths
    .map(fp => {
      const relativePath = path.relative(cwd, fp);
      const fileLocalIssues = localByFile.get(relativePath) || [];
      return generateFingerprint(fp, cwd, fileLocalIssues);
    })
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

  // Multi-model routing: use budget tracker to select optimal model per chunk
  const tierInfo = getModelTier(model);
  const CONCURRENCY = Math.min(3, tierInfo.concurrent);
  const systemMsg = customPrompt
    ? `You are a code quality analyzer. Report only real issues with exact file paths and line numbers. Include the evidence field with the exact code pattern you saw, and line_content with the actual line text.\n\n${customPrompt}`
    : 'You are a code quality analyzer. Report only real issues with exact file paths and line numbers. Include the evidence field with the exact code pattern you saw, and line_content with the actual line text.';

  // Process chunks in concurrent batches
  for (let batchStart = 0; batchStart < chunks.length; batchStart += CONCURRENCY) {
    const batch = chunks.slice(batchStart, batchStart + CONCURRENCY);

    // Log what we're dispatching
    for (let j = 0; j < batch.length; j++) {
      const idx = batchStart + j;
      const fileCount = batch[j].fingerprints.length;
      core.info(ui.progressBar(idx + 1, chunks.length, 20, `${fileCount} files (~${batch[j].totalTokens} tokens)`));
    }

    // Fire all requests in this batch concurrently, with per-chunk model selection
    const results = await Promise.allSettled(
      batch.map(async (chunk, j) => {
        // Stagger starts slightly to avoid hitting rate limits simultaneously
        if (j > 0) await sleep(500 * j);

        // Select model: prefer low-tier for fingerprint scans to conserve primary budget
        const chunkModel = budget
          ? budget.selectModel(model, 'fingerprint')
          : model;

        const chunkStart = Date.now();
        const { content, tokens } = await callGitHubModels(
          [
            { role: 'system', content: systemMsg },
            { role: 'user', content: chunk.promptText },
          ],
          chunkModel,
          { responseFormat: ISSUES_SCHEMA },
        );

        // Record the API call in the budget tracker
        if (budget) budget.recordRequest(chunkModel);

        return { content, tokens, elapsed: Date.now() - chunkStart, usedModel: chunkModel };
      }),
    );

    // Collect results
    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      if (r.status === 'fulfilled') {
        const { content, tokens, elapsed, usedModel } = r.value;
        totalTokens += tokens;
        apiCalls++;
        const chunkIssues = parseIssues(content);
        allIssues.push(...chunkIssues);

        const elapsedStr = formatDuration(elapsed);
        const modelLabel = usedModel !== model ? ` via ${usedModel}` : '';
        if (chunkIssues.length > 0) {
          core.info(`    ${ui.c(ui.SYM.bullet, ui.S.yellow)} Found ${ui.c(String(chunkIssues.length), ui.S.bold)} issues ${ui.c(`(${tokens} tokens, ${elapsedStr}${modelLabel})`, ui.S.gray)}`);
        } else {
          core.info(`    ${ui.c(ui.SYM.check, ui.S.green)} Clean ${ui.c(`(${tokens} tokens, ${elapsedStr}${modelLabel})`, ui.S.gray)}`);
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
    ? `You are a code quality analyzer. Report only real issues with exact file paths and line numbers. Include the evidence field with the exact code pattern you saw, and line_content with the actual line text.\n\n${customPrompt}`
    : 'You are a code quality analyzer. Report only real issues with exact file paths and line numbers. Include the evidence field with the exact code pattern you saw, and line_content with the actual line text.';

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

  // Initialize adaptive budget tracker (Option 6)
  const budget = new ScanBudget(cwd);

  const scope = config.scanScope;
  const isPR = !!github.context.payload.pull_request;
  const usePrDiff = scope === 'pr' || (scope === 'auto' && isPR);

  ui.section('SCAN');
  ui.kv('Model', config.githubModelsModel);
  ui.kv('Scope', `${scope}${scope === 'auto' ? (isPR ? ' \u2192 pr' : ' \u2192 full') : ''}`);
  budget.logStatus(config.githubModelsModel);

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
    // Now includes: missing return types, unused imports, console.log,
    // debugger, any-type usage, plus all original patterns.
    // ================================================================
    ui.section('Layer 0: Local Analysis');
    const extraPatterns = pluginCtx?.extraPatterns || [];
    const { issues: localIssues, flaggedFiles } = localScanAll(filesToScan, cwd, extraPatterns);
    if (localIssues.length > 0) {
      // Break down local findings by type for visibility
      const localByType: Record<string, number> = {};
      for (const i of localIssues) localByType[i.type] = (localByType[i.type] || 0) + 1;
      const localBreakdown = Object.entries(localByType)
        .sort((a, b) => b[1] - a[1])
        .map(([t, n]) => `${t}(${n})`)
        .join(', ');
      core.info(`  Found ${ui.c(String(localIssues.length), ui.S.bold)} issues locally ${ui.c(`(${flaggedFiles.size} files: ${localBreakdown})`, ui.S.gray)}`);
      allIssues.push(...localIssues);
    } else {
      core.info(`  ${ui.c(ui.SYM.check, ui.S.green)} No local issues found`);
    }

    // ================================================================
    // ADAPTIVE BUDGET CHECK (Option 6)
    // Adjust AI scan strategy based on remaining API budget.
    // ================================================================
    const scanLevel = budget.getScanLevel(config.githubModelsModel);

    if (scanLevel === 'critical') {
      core.info(`  ${ui.c('!', ui.S.yellow)} API budget critical — skipping AI scan, using local results only`);
    } else {
      // ================================================================
      // LAYER 1: AI scan — strategy depends on file count + budget
      //
      // PR / small sets (≤15 files): deep scan with full file contents.
      //   Accuracy matters more than speed when the set is small, and
      //   full content fits in a handful of API calls anyway.
      //
      // Full repo / large sets (>15 files): fingerprint scan.
      //   Compact representations (~100 tokens/file) let us pack 20+
      //   files per request, cutting 33 API calls to 3-5.
      //
      // Budget-aware: fingerprint scans route to low-tier models
      // to conserve high-tier budget for deep scans (Option 4).
      // ================================================================
      const useDeepScan = scanStrategy === 'deep' && scanLevel === 'flush';
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

        // Select model for deep scan via budget tracker (Option 4)
        const deepModel = budget.selectModel(config.githubModelsModel, 'deep');
        if (deepModel !== config.githubModelsModel) {
          core.info(`  ${ui.c('Model routed:', ui.S.gray)} ${deepModel} (primary budget conserved)`);
        }

        const DEEP_CONCURRENCY = Math.min(3, getModelTier(deepModel).concurrent);
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
              if (j > 0) await sleep(500 * j);
              const chunkStart = Date.now();
              const { issues: chunkIssues, tokens } = await scanChunk(
                chunk, batchStart + j + 1, chunks.length, deepModel, 0, customPrompt || undefined,
              );
              budget.recordRequest(deepModel);
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
        // Pass local issues for annotation (Option 5) and budget for model routing (Option 4)
        const fpResult = await runFingerprintScan(
          filesToScan, cwd, config.githubModelsModel,
          customPrompt || undefined, localIssues, budget,
        );
        aiIssues = fpResult.issues;
        totalTokens += fpResult.tokens;
        totalApiCalls += fpResult.apiCalls;

        // TARGETED DEEP SCAN (Option C)
        // Fingerprint scan identifies suspicious files. Deep scan them with full
        // code for higher accuracy. Uses 1-3 extra API calls on suspicious files.
        if (aiIssues.length > 0 && scanLevel === 'flush') {
          const suspiciousFileSet = new Set(aiIssues.map(i => i.file));
          const suspiciousFilePaths = filesToScan
            .filter(fp => suspiciousFileSet.has(path.relative(cwd, fp)))
            .slice(0, 5);

          if (suspiciousFilePaths.length > 0) {
            const deepModel = budget.selectModel(config.githubModelsModel, 'deep');
            if (budget.remaining(deepModel) > 0) {
              core.info(`  ${ui.c('Targeted deep scan:', ui.S.gray)} ${suspiciousFilePaths.length} suspicious files`);
              const deepChunks = prepareChunks(suspiciousFilePaths, cwd, deepModel);

              for (const chunk of deepChunks) {
                if (budget.remaining(deepModel) < 1) break;
                try {
                  const chunkStart = Date.now();
                  const { issues: deepIssues, tokens } = await scanChunk(
                    chunk, 1, deepChunks.length, deepModel, 0, customPrompt || undefined,
                  );
                  budget.recordRequest(deepModel);
                  totalTokens += tokens;
                  totalApiCalls++;
                  aiIssues.push(...deepIssues);
                  const elapsed = formatDuration(Date.now() - chunkStart);
                  if (deepIssues.length > 0) {
                    core.info(`    ${ui.c(ui.SYM.bullet, ui.S.yellow)} Deep scan found ${ui.c(String(deepIssues.length), ui.S.bold)} additional issues ${ui.c(`(${tokens} tokens, ${elapsed})`, ui.S.gray)}`);
                  } else {
                    core.info(`    ${ui.c(ui.SYM.check, ui.S.green)} Deep scan clean ${ui.c(`(${tokens} tokens, ${elapsed})`, ui.S.gray)}`);
                  }
                } catch (e) {
                  core.warning(`  Targeted deep scan chunk failed: ${e}`);
                }
              }
            }
          }
        }
      }

      // ================================================================
      // POST-SCAN VERIFICATION (Option 3)
      // Verify AI issues against actual file contents. Zero API cost.
      // ================================================================
      if (aiIssues.length > 0) {
        const { verified, rejected } = verifyIssues(aiIssues, localIssues, cwd);
        if (rejected.length > 0) {
          core.info(`  ${ui.c('Verification:', ui.S.gray)} ${verified.length} verified, ${ui.c(String(rejected.length), ui.S.yellow)} rejected (duplicates/hallucinations)`);
        }
        aiIssues = verified;
      }

      // AI VERIFICATION PASS (Option B)
      // Send actual code context to a low-tier model to catch hallucinations.
      if (aiIssues.length > 0) {
        aiIssues = await runAIVerificationPass(aiIssues, cwd, config.githubModelsModel, budget);
      }

      allIssues.push(...aiIssues);

      // Run post-scan hooks
      if (pluginCtx) await runHook(pluginCtx.plugins, 'post-scan');

      // Update cache with new results
      const newIssues = [...localIssues, ...aiIssues];
      updateCacheEntries(cache, newIssues, filesToScan, cwd, scanStrategy);
      saveCache(cwd, cache);
    }
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
  const localCount = unique.filter(i => i.source === 'local').length;
  const aiCount = unique.filter(i => i.source === 'ai').length;
  const otherCount = unique.length - localCount - aiCount;
  const sourceBreakdown = [
    localCount > 0 ? `${localCount} local` : '',
    aiCount > 0 ? `${aiCount} AI` : '',
    otherCount > 0 ? `${otherCount} cached` : '',
  ].filter(Boolean).join(', ');
  ui.stat('Issues', `${unique.length} found${sourceBreakdown ? ` (${sourceBreakdown})` : ''}`);
  ui.stat('API calls', String(totalApiCalls));
  ui.stat('Cache', `${cacheHits}/${files.length} files`);
  ui.stat('Tokens', totalTokens.toLocaleString());
  ui.stat('Duration', totalElapsed);
  budget.logStatus(config.githubModelsModel);

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
