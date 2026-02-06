import * as core from '@actions/core';
import * as fs from 'fs';
import * as path from 'path';
import { callGitHubModels } from './github-models';
import { SloppyConfig, Issue, ScanResult, IssueType, Severity } from './types';

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

function chunkFiles(files: string[], maxChars: number = 24000): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let size = 0;

  for (const file of files) {
    try {
      const len = fs.statSync(file).size;
      if (len > maxChars) {
        chunks.push([file]);
        continue;
      }
      if (size + len > maxChars && current.length > 0) {
        chunks.push(current);
        current = [];
        size = 0;
      }
      current.push(file);
      size += len;
    } catch {
      continue;
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function buildPrompt(files: string[], cwd: string): string {
  let prompt = `Analyze these source files for code quality issues. Be thorough and precise.

Categories: security, bugs, types, lint, dead-code, stubs, duplicates, coverage
Severities: critical, high, medium, low

Respond ONLY with valid JSON (no markdown, no code fences, no explanation):
{"issues":[{"type":"...","severity":"...","file":"relative/path","line":0,"description":"..."}]}

Files:

`;
  for (const file of files) {
    const rel = path.relative(cwd, file);
    try {
      let content = fs.readFileSync(file, 'utf-8');
      if (content.length > 12000) content = content.slice(0, 12000) + '\n...(truncated)';
      prompt += `--- ${rel} ---\n${content}\n\n`;
    } catch {
      continue;
    }
  }
  return prompt;
}

function parseIssues(content: string): Issue[] {
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

export function calculateScore(issues: Issue[]): number {
  const penalties: Record<Severity, number> = { critical: 10, high: 5, medium: 2, low: 1 };
  let score = 100;
  for (const issue of issues) {
    score -= penalties[issue.severity] || 1;
  }
  return Math.max(0, Math.min(100, score));
}

export async function runScan(config: SloppyConfig): Promise<ScanResult> {
  const cwd = process.env.GITHUB_WORKSPACE || process.cwd();
  core.info('Collecting source files...');
  const files = collectFiles(cwd);
  core.info(`Found ${files.length} source files`);

  if (files.length === 0) {
    return { issues: [], score: 100, summary: 'No source files found.', tokens: 0 };
  }

  const chunks = chunkFiles(files);
  core.info(`Analyzing in ${chunks.length} chunk(s)...`);

  const allIssues: Issue[] = [];
  let totalTokens = 0;

  for (let i = 0; i < chunks.length; i++) {
    core.info(`  Chunk ${i + 1}/${chunks.length}...`);
    try {
      const { content, tokens } = await callGitHubModels(
        [
          { role: 'system', content: 'You are a code quality analyzer. Respond ONLY with valid JSON.' },
          { role: 'user', content: buildPrompt(chunks[i], cwd) },
        ],
        config.githubModelsModel,
      );
      totalTokens += tokens;
      allIssues.push(...parseIssues(content));
    } catch (e) {
      core.warning(`Chunk ${i + 1} failed: ${e}`);
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
  const summary = `Found ${unique.length} issues across ${files.length} files. Score: ${score}/100.`;
  core.info(summary);

  return { issues: unique, score, summary, tokens: totalTokens };
}
