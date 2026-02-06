import * as core from '@actions/core';
import * as github from '@actions/github';
import * as fs from 'fs';
import * as path from 'path';
import { LoopState, ScanResult, Issue, HistoryEntry } from './types';

// --- Helpers ---

function severityIcon(s: string): string {
  const map: Record<string, string> = { critical: '!!', high: '!', medium: '~', low: '.' };
  return map[s] || '?';
}

function scoreGrade(score: number): string {
  if (score >= 90) return 'excellent';
  if (score >= 70) return 'good';
  if (score >= 50) return 'fair';
  if (score >= 30) return 'poor';
  return 'critical';
}

function progressBar(score: number, w = 20): string {
  const filled = Math.round((score / 100) * w);
  return '\u2588'.repeat(filled) + '\u2591'.repeat(w - filled);
}

function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m < 60) return `${m}m ${sec}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function groupBy(issues: Issue[]): Record<string, Issue[]> {
  const g: Record<string, Issue[]> = {};
  for (const i of issues) (g[i.type] ??= []).push(i);
  return g;
}

// --- PR Body for Fix Mode ---

export function buildFixPRBody(state: LoopState): string {
  const fixed = state.issues.filter(i => i.status === 'fixed');
  const skipped = state.issues.filter(i => i.status === 'skipped');
  const byType = groupBy(fixed);
  const dur = state.passes.reduce((s, p) => s + p.durationMs, 0);
  const delta = state.scoreAfter - state.scoreBefore;

  let md = `## Sloppy Report\n\n`;
  md += `**Score: ${state.scoreBefore} → ${state.scoreAfter}** (${delta >= 0 ? '+' : ''}${delta})\n\n`;
  md += `${progressBar(state.scoreAfter)} ${state.scoreAfter}/100\n\n---\n\n`;

  md += `| Metric | Value |\n|--------|-------|\n`;
  md += `| Fixed | **${state.totalFixed}** |\n`;
  md += `| Skipped | ${state.totalSkipped} |\n`;
  md += `| Passes | ${state.passes.length} |\n`;
  md += `| Duration | ${fmtDuration(dur)} |\n\n`;

  if (fixed.length > 0) {
    md += `### Fixed (${fixed.length})\n\n`;
    for (const [type, issues] of Object.entries(byType)) {
      md += `<details>\n<summary>${type} (${issues.length})</summary>\n\n`;
      md += `| File | Issue | Commit |\n|------|-------|--------|\n`;
      for (const i of issues) {
        const sha = i.commitSha?.slice(0, 7) || '-';
        const loc = i.line ? `${i.file}:${i.line}` : i.file;
        md += `| \`${loc}\` | ${i.description} | \`${sha}\` |\n`;
      }
      md += `\n</details>\n\n`;
    }
  }

  if (skipped.length > 0) {
    md += `<details>\n<summary>Skipped (${skipped.length})</summary>\n\n`;
    md += `| File | Issue | Reason |\n|------|-------|--------|\n`;
    for (const i of skipped) {
      md += `| \`${i.file}\` | ${i.description} | ${i.skipReason || '-'} |\n`;
    }
    md += `\n</details>\n\n`;
  }

  md += `<details open>\n<summary>Pass Breakdown</summary>\n\n`;
  md += `| Pass | Found | Fixed | Skipped | Duration |\n|------|-------|-------|---------|----------|\n`;
  for (const p of state.passes) {
    md += `| ${p.number} | ${p.found} | ${p.fixed} | ${p.skipped} | ${fmtDuration(p.durationMs)} |\n`;
  }
  md += `\n</details>\n\n---\n\n`;
  md += `Merge to accept all fixes. Close to reject. Revert individual commits as needed.\n\n`;
  md += `*[Sloppy](https://github.com/braedonsaunders/sloppy) — relentless AI code cleanup*`;

  return md;
}

// --- PR Comment for Scan Mode ---

export function buildScanComment(result: ScanResult): string {
  const grouped = groupBy(result.issues);

  let md = `## Sloppy Scan\n\n`;
  md += `**Score: ${result.score}/100** — ${scoreGrade(result.score)}\n\n`;
  md += `${progressBar(result.score)} ${result.score}/100\n\n`;

  if (result.issues.length === 0) {
    md += `No issues found. Code is clean.\n`;
    return md;
  }

  md += `| Type | Count | Worst |\n|------|-------|-------|\n`;
  for (const [type, issues] of Object.entries(grouped)) {
    const worst = issues.reduce((w, i) => {
      const order = ['critical', 'high', 'medium', 'low'];
      return order.indexOf(i.severity) < order.indexOf(w) ? i.severity : w;
    }, 'low' as string);
    md += `| ${type} | ${issues.length} | ${worst} |\n`;
  }

  md += `\nAdd an API key and set \`mode: fix\` to auto-fix these issues.\n\n`;
  md += `*[Sloppy](https://github.com/braedonsaunders/sloppy)*`;
  return md;
}

// --- Job Summary ---

export async function writeJobSummary(data: ScanResult | LoopState): Promise<void> {
  let md = `## Sloppy Results\n\n`;

  if ('summary' in data) {
    const r = data as ScanResult;
    md += `### Score: ${r.score}/100 — ${scoreGrade(r.score)}\n\n`;
    md += `${progressBar(r.score)} ${r.score}/100\n\n`;
    md += `${r.summary}\n\n`;

    if (r.issues.length > 0) {
      // Issue summary table
      md += `| Type | Count | Worst Severity |\n|------|-------|---------|\n`;
      for (const [type, issues] of Object.entries(groupBy(r.issues))) {
        const worst = issues.reduce((w, i) => {
          const order = ['critical', 'high', 'medium', 'low'];
          return order.indexOf(i.severity) < order.indexOf(w) ? i.severity : w;
        }, 'low' as string);
        md += `| ${type} | ${issues.length} | ${worst} |\n`;
      }
      md += '\n';

      // Full issues list (collapsible)
      md += `<details>\n<summary>All issues (${r.issues.length})</summary>\n\n`;
      md += `| Severity | Type | File | Line | Description |\n|----------|------|------|------|-------------|\n`;
      const sorted = [...r.issues].sort((a, b) => {
        const order = ['critical', 'high', 'medium', 'low'];
        return order.indexOf(a.severity) - order.indexOf(b.severity);
      });
      for (const i of sorted) {
        md += `| ${i.severity} | ${i.type} | \`${i.file}\` | ${i.line || '-'} | ${i.description} |\n`;
      }
      md += `\n</details>\n\n`;

      // Mermaid pie chart
      md += `\`\`\`mermaid\npie title Issues by Type\n`;
      for (const [type, issues] of Object.entries(groupBy(r.issues))) {
        md += `    "${type}" : ${issues.length}\n`;
      }
      md += `\`\`\`\n\n`;
    }

    md += `---\n*Add an API key and set \`mode: fix\` to auto-fix these issues. [Learn more](https://github.com/braedonsaunders/sloppy)*\n`;
  } else {
    const s = data as LoopState;
    const dur = s.passes.reduce((sum, p) => sum + p.durationMs, 0);
    const d = s.scoreAfter - s.scoreBefore;
    md += `### Score: ${s.scoreBefore} → ${s.scoreAfter} (${d >= 0 ? '+' : ''}${d})\n\n`;
    md += `${progressBar(s.scoreAfter)} ${s.scoreAfter}/100\n\n`;
    md += `| Metric | Value |\n|--------|-------|\n`;
    md += `| Passes | ${s.passes.length} |\n`;
    md += `| Fixed | **${s.totalFixed}** |\n`;
    md += `| Skipped | ${s.totalSkipped} |\n`;
    md += `| Duration | ${fmtDuration(dur)} |\n\n`;

    if (s.totalFixed > 0) {
      const fixed = s.issues.filter(i => i.status === 'fixed');
      const byType = groupBy(fixed);

      md += `<details open>\n<summary>Fixed issues (${fixed.length})</summary>\n\n`;
      for (const [type, issues] of Object.entries(byType)) {
        md += `**${type}** (${issues.length})\n\n`;
        md += `| File | Issue | Commit |\n|------|-------|--------|\n`;
        for (const i of issues) {
          const sha = i.commitSha?.slice(0, 7) || '-';
          md += `| \`${i.file}:${i.line || '?'}\` | ${i.description} | \`${sha}\` |\n`;
        }
        md += '\n';
      }
      md += `</details>\n\n`;

      md += `\`\`\`mermaid\npie title Fixed by Type\n`;
      for (const [type, issues] of Object.entries(byType)) {
        md += `    "${type}" : ${issues.length}\n`;
      }
      md += `\`\`\`\n\n`;
    }

    // Pass breakdown
    md += `<details>\n<summary>Pass breakdown</summary>\n\n`;
    md += `| Pass | Found | Fixed | Skipped | Duration |\n|------|-------|-------|---------|----------|\n`;
    for (const p of s.passes) {
      md += `| ${p.number} | ${p.found} | ${p.fixed} | ${p.skipped} | ${fmtDuration(p.durationMs)} |\n`;
    }
    md += `\n</details>\n\n`;

    md += `---\n*[Sloppy](https://github.com/braedonsaunders/sloppy) — relentless AI code cleanup*\n`;
  }

  await core.summary.addRaw(md).write();
}

// --- PR Creation ---

export async function createPullRequest(state: LoopState): Promise<string | null> {
  const token = process.env.GITHUB_TOKEN;
  if (!token || state.totalFixed === 0) return null;

  const octokit = github.getOctokit(token);
  const [owner, repo] = (process.env.GITHUB_REPOSITORY || '').split('/');
  const base = process.env.GITHUB_REF_NAME || 'main';
  const d = state.scoreAfter - state.scoreBefore;
  const title = `sloppy: fix ${state.totalFixed} issues (score ${state.scoreBefore} → ${state.scoreAfter})`;

  try {
    const { data: pr } = await octokit.rest.pulls.create({
      owner,
      repo,
      title,
      body: buildFixPRBody(state),
      head: state.branchName,
      base,
    });
    core.info(`PR created: ${pr.html_url}`);
    return pr.html_url;
  } catch (e) {
    core.warning(`Failed to create PR: ${e}`);
    return null;
  }
}

// --- Scan Comment on Existing PR ---

export async function postScanComment(result: ScanResult): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return;

  const ctx = github.context;
  if (!ctx.payload.pull_request) return;

  try {
    const octokit = github.getOctokit(token);
    await octokit.rest.issues.createComment({
      owner: ctx.repo.owner,
      repo: ctx.repo.repo,
      issue_number: ctx.payload.pull_request.number,
      body: buildScanComment(result),
    });
  } catch (e) {
    core.warning(`Failed to post comment: ${e}`);
  }
}

// --- Badge ---

export async function updateBadge(score: number): Promise<void> {
  const gistId = core.getInput('gist-id');
  const gistToken = core.getInput('gist-token');
  if (!gistId || !gistToken) return;

  const color = score >= 90 ? 'brightgreen' : score >= 70 ? 'green' : score >= 50 ? 'yellow' : score >= 30 ? 'orange' : 'red';
  const repoName = (process.env.GITHUB_REPOSITORY || '').split('/').pop() || 'repo';

  try {
    const octokit = github.getOctokit(gistToken);
    await octokit.rest.gists.update({
      gist_id: gistId,
      files: {
        [`${repoName}-sloppy.json`]: {
          content: JSON.stringify({ schemaVersion: 1, label: 'sloppy', message: `${score}/100`, color }),
        },
      },
    });
    core.info(`Badge updated: ${score}/100`);
  } catch (e) {
    core.warning(`Badge update failed: ${e}`);
  }
}

// --- History ---

export function appendHistory(entry: HistoryEntry): HistoryEntry[] {
  const cwd = process.env.GITHUB_WORKSPACE || process.cwd();
  const dir = path.join(cwd, '.sloppy');
  const file = path.join(dir, 'history.json');

  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  let history: HistoryEntry[] = [];
  if (fs.existsSync(file)) {
    try { history = JSON.parse(fs.readFileSync(file, 'utf-8')); } catch {}
  }
  history.push(entry);
  fs.writeFileSync(file, JSON.stringify(history, null, 2));
  return history;
}
