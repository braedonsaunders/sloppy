import * as core from '@actions/core';
import * as github from '@actions/github';
import * as fs from 'fs';
import * as path from 'path';
import { LoopState, ScanResult, Issue, HistoryEntry, SloppyConfig } from './types';

// --- Helpers ---

function severityIcon(s: string): string {
  const map: Record<string, string> = { critical: '\u{1F534}', high: '\u{1F7E0}', medium: '\u{1F7E1}', low: '\u{1F535}' };
  return map[s] || '\u26AA';
}

function severityLabel(s: string): string {
  const map: Record<string, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };
  return map[s] || s;
}

function typeIcon(t: string): string {
  const map: Record<string, string> = {
    security: '\u{1F512}', bugs: '\u{1F41B}', types: '\u{1F4DD}', lint: '\u{1F9F9}',
    'dead-code': '\u{1F480}', stubs: '\u{1F3D7}\uFE0F', duplicates: '\u{1F4CB}', coverage: '\u{1F9EA}',
  };
  return map[t] || '\u{1F4CC}';
}

function scoreEmoji(score: number): string {
  if (score >= 90) return '\u{1F7E2}';
  if (score >= 70) return '\u{1F535}';
  if (score >= 50) return '\u{1F7E1}';
  if (score >= 30) return '\u{1F7E0}';
  return '\u{1F534}';
}

function scoreGrade(score: number): string {
  if (score >= 90) return 'Excellent';
  if (score >= 70) return 'Good';
  if (score >= 50) return 'Fair';
  if (score >= 30) return 'Poor';
  return 'Critical';
}

function scoreLetter(score: number): string {
  if (score >= 90) return 'A';
  if (score >= 70) return 'B';
  if (score >= 50) return 'C';
  if (score >= 30) return 'D';
  return 'F';
}

function progressBar(score: number, w = 20): string {
  const filled = Math.round((score / 100) * w);
  return '\u2588'.repeat(filled) + '\u2591'.repeat(w - filled);
}

function miniBar(count: number, max: number, w = 10): string {
  if (max === 0) return '\u2591'.repeat(w);
  const filled = Math.max(1, Math.round((count / max) * w));
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

function severityOrder(s: string): number {
  const order = ['critical', 'high', 'medium', 'low'];
  const idx = order.indexOf(s);
  return idx >= 0 ? idx : 999;
}

function worstSeverity(issues: Issue[]): string {
  return issues.reduce((w, i) => {
    return severityOrder(i.severity) < severityOrder(w) ? i.severity : w;
  }, 'low' as string);
}

// --- PR Body for Fix Mode ---

export function buildFixPRBody(state: LoopState): string {
  const fixed = state.issues.filter(i => i.status === 'fixed');
  const skipped = state.issues.filter(i => i.status === 'skipped');
  const byType = groupBy(fixed);
  const dur = state.passes.reduce((s, p) => s + p.durationMs, 0);
  const delta = state.scoreAfter - state.scoreBefore;
  const sign = delta >= 0 ? '+' : '';

  let md = `<div align="center">\n\n`;
  md += `## \u{1F9F9} Sloppy Fix Report\n\n`;
  md += `<table>\n<tr>\n`;
  md += `<td align="center" width="120">\n\n${scoreEmoji(state.scoreBefore)}\n### ${state.scoreBefore}\n**Before**\n\n</td>\n`;
  md += `<td align="center" width="60">\n\n### \u2192\n\n</td>\n`;
  md += `<td align="center" width="120">\n\n${scoreEmoji(state.scoreAfter)}\n### ${state.scoreAfter}\n**After**\n\n</td>\n`;
  md += `<td align="center" width="100">\n\n### ${sign}${delta}\n**Delta**\n\n</td>\n`;
  md += `</tr>\n</table>\n\n`;
  md += `\`${progressBar(state.scoreAfter)}\` ${state.scoreAfter}/100 \u00B7 **${scoreGrade(state.scoreAfter)}**\n\n`;
  md += `</div>\n\n---\n\n`;

  md += `<table>\n<tr>\n`;
  md += `<td align="center">\n\n**${state.totalFixed}**\n\n\u{1F527} Fixed\n\n</td>\n`;
  md += `<td align="center">\n\n**${state.totalSkipped}**\n\n\u23ED\uFE0F Skipped\n\n</td>\n`;
  md += `<td align="center">\n\n**${state.passes.length}**\n\n\u{1F504} Passes\n\n</td>\n`;
  md += `<td align="center">\n\n**${fmtDuration(dur)}**\n\n\u23F1\uFE0F Duration\n\n</td>\n`;
  md += `</tr>\n</table>\n\n`;

  if (fixed.length > 0) {
    const sortedTypes = Object.entries(byType).sort((a, b) => b[1].length - a[1].length);
    md += `### \u2705 Fixed Issues (${fixed.length})\n\n`;
    for (const [type, issues] of sortedTypes) {
      md += `<details open>\n<summary>${typeIcon(type)} <strong>${type}</strong> \u2014 ${issues.length} fixed</summary>\n\n`;
      md += `| | File | Issue | Commit |\n|:---:|:-----|:------|:-------|\n`;
      for (const i of issues) {
        const sha = i.commitSha?.slice(0, 7) || '-';
        const loc = i.line ? `${i.file}:${i.line}` : i.file;
        md += `| ${severityIcon(i.severity)} | \`${loc}\` | ${i.description} | \`${sha}\` |\n`;
      }
      md += `\n</details>\n\n`;
    }
  }

  if (skipped.length > 0) {
    md += `<details>\n<summary>\u23ED\uFE0F Skipped Issues (${skipped.length})</summary>\n\n`;
    md += `| | File | Issue | Reason |\n|:---:|:-----|:------|:-------|\n`;
    for (const i of skipped) {
      md += `| ${severityIcon(i.severity)} | \`${i.file}\` | ${i.description} | ${i.skipReason || '-'} |\n`;
    }
    md += `\n</details>\n\n`;
  }

  md += `<details>\n<summary>\u{1F504} Pass Breakdown</summary>\n\n`;
  md += `| Pass | Found | Fixed | Skipped | Duration |\n|:----:|:-----:|:-----:|:-------:|:--------:|\n`;
  for (const p of state.passes) {
    md += `| **${p.number}** | ${p.found} | ${p.fixed} | ${p.skipped} | ${fmtDuration(p.durationMs)} |\n`;
  }
  md += `\n</details>\n\n---\n\n`;

  md += `> **Merge** to accept all fixes \u00B7 **Close** to reject \u00B7 Revert individual commits as needed\n\n`;
  md += `<div align="center">\n<sub>\u{1F9F9} <a href="https://github.com/braedonsaunders/sloppy">Sloppy</a> \u2014 relentless AI code cleanup</sub>\n</div>\n`;

  return md;
}

// --- PR Comment for Scan Mode ---

export function buildScanComment(result: ScanResult): string {
  const grouped = groupBy(result.issues);

  let md = `<div align="center">\n\n`;
  md += `## \u{1F9F9} Sloppy Scan\n\n`;
  md += `${scoreEmoji(result.score)} **${result.score}/100** \u00B7 ${scoreGrade(result.score)} \u00B7 Grade ${scoreLetter(result.score)}\n\n`;
  md += `\`${progressBar(result.score)}\`\n\n`;
  md += `</div>\n\n`;

  if (result.issues.length === 0) {
    md += `> [!NOTE]\n> No issues found \u2014 your code is clean! \u2728\n`;
    return md;
  }

  const sortedTypes = Object.entries(grouped).sort((a, b) => {
    return severityOrder(worstSeverity(a[1])) - severityOrder(worstSeverity(b[1]));
  });
  const maxCount = Math.max(...Object.values(grouped).map(g => g.length));

  md += `| | Category | Issues | Severity | Distribution |\n`;
  md += `|:---:|:---------|:------:|:--------:|:-------------|\n`;
  for (const [type, issues] of sortedTypes) {
    const worst = worstSeverity(issues);
    md += `| ${typeIcon(type)} | **${type}** | ${issues.length} | ${severityIcon(worst)} ${severityLabel(worst)} | \`${miniBar(issues.length, maxCount, 10)}\` |\n`;
  }

  md += `\n> [!TIP]\n> Add an API key and set \`mode: fix\` to auto-fix these issues. [Learn more \u2192](https://github.com/braedonsaunders/sloppy)\n\n`;
  md += `<div align="center">\n<sub>\u{1F9F9} <a href="https://github.com/braedonsaunders/sloppy">Sloppy</a> \u2014 relentless AI code cleanup</sub>\n</div>\n`;
  return md;
}

// --- Job Summary ---

export async function writeJobSummary(data: ScanResult | LoopState): Promise<void> {
  let md = '';

  if ('summary' in data) {
    // ===================== SCAN MODE =====================
    const r = data as ScanResult;
    const grade = scoreGrade(r.score);
    const emoji = scoreEmoji(r.score);
    const letter = scoreLetter(r.score);

    // ---- Hero header ----
    md += `<div align="center">\n\n`;
    md += `# \u{1F9F9} Sloppy \u2014 Code Quality Report\n\n`;

    // ---- Score card ----
    md += `<table>\n<tr>\n`;
    md += `<td align="center" width="200">\n\n`;
    md += `${emoji}\n### ${r.score} / 100\n\n`;
    md += `\`${progressBar(r.score, 16)}\`\n\n`;
    md += `**${grade}** \u00B7 Grade **${letter}**\n\n`;
    md += `</td>\n<td>\n\n`;
    md += `${r.summary}\n\n`;
    if (r.issues.length > 0) {
      const catCount = Object.keys(groupBy(r.issues)).length;
      md += `\u{1F50D} **${r.issues.length} issue${r.issues.length !== 1 ? 's' : ''}** found across **${catCount} categor${catCount !== 1 ? 'ies' : 'y'}**\n\n`;
    } else {
      md += `\u2728 **No issues found** \u2014 your code is clean!\n\n`;
    }
    md += `</td>\n</tr>\n</table>\n\n`;
    md += `</div>\n\n`;

    if (r.issues.length > 0) {
      md += `---\n\n`;

      // ---- Issue breakdown ----
      const grouped = groupBy(r.issues);
      const maxCount = Math.max(...Object.values(grouped).map(g => g.length));
      const sortedTypes = Object.entries(grouped).sort((a, b) => {
        return severityOrder(worstSeverity(a[1])) - severityOrder(worstSeverity(b[1]));
      });

      md += `### \u{1F4CA} Issue Breakdown\n\n`;
      md += `| | Category | Issues | Severity | Distribution |\n`;
      md += `|:---:|:---------|:------:|:--------:|:-------------|\n`;
      for (const [type, issues] of sortedTypes) {
        const worst = worstSeverity(issues);
        md += `| ${typeIcon(type)} | **${type}** | ${issues.length} | ${severityIcon(worst)} ${severityLabel(worst)} | \`${miniBar(issues.length, maxCount, 12)}\` |\n`;
      }
      md += '\n';

      // ---- Severity alerts ----
      const bySeverity: Record<string, number> = {};
      for (const i of r.issues) bySeverity[i.severity] = (bySeverity[i.severity] || 0) + 1;

      if (bySeverity['critical']) {
        md += `> [!CAUTION]\n`;
        md += `> **${bySeverity['critical']} critical issue${bySeverity['critical'] > 1 ? 's' : ''}** require immediate attention.\n\n`;
      } else if (bySeverity['high']) {
        md += `> [!WARNING]\n`;
        md += `> **${bySeverity['high']} high-severity issue${bySeverity['high'] > 1 ? 's' : ''}** should be addressed soon.\n\n`;
      }

      // ---- Severity distribution ----
      md += `<details>\n<summary>\u{1F3AF} Severity Distribution</summary>\n\n`;
      md += `| | Severity | Count | Share |\n|:---:|:---------|:------:|:-----:|\n`;
      for (const sev of ['critical', 'high', 'medium', 'low']) {
        if (bySeverity[sev]) {
          const pct = Math.round((bySeverity[sev] / r.issues.length) * 100);
          md += `| ${severityIcon(sev)} | ${severityLabel(sev)} | **${bySeverity[sev]}** | ${pct}% |\n`;
        }
      }
      md += `\n</details>\n\n`;

      // ---- Full issues list ----
      const sorted = [...r.issues].sort((a, b) => severityOrder(a.severity) - severityOrder(b.severity));
      md += `<details>\n<summary>\u{1F4CB} All Issues (${r.issues.length})</summary>\n\n`;
      md += `| | Severity | Type | File | Line | Description |\n`;
      md += `|:---:|:---------|:-----|:-----|:----:|:------------|\n`;
      for (const i of sorted) {
        md += `| ${severityIcon(i.severity)} | ${severityLabel(i.severity)} | ${typeIcon(i.type)} ${i.type} | \`${i.file}\` | ${i.line || '-'} | ${i.description} |\n`;
      }
      md += `\n</details>\n\n`;

      // ---- Mermaid pie chart ----
      md += `<details>\n<summary>\u{1F4C8} Issue Distribution Chart</summary>\n\n`;
      md += `\`\`\`mermaid\npie showData title Issues by Category\n`;
      for (const [type, issues] of sortedTypes) {
        md += `    "${typeIcon(type)} ${type}" : ${issues.length}\n`;
      }
      md += `\`\`\`\n\n</details>\n\n`;
    }

    // ---- Footer ----
    md += `---\n\n`;
    if (r.issues.length > 0) {
      md += `> [!TIP]\n`;
      md += `> Add an API key and set \`mode: fix\` to auto-fix these issues. [Learn more \u2192](https://github.com/braedonsaunders/sloppy)\n\n`;
    }
    md += `<div align="center">\n<sub>\u{1F9F9} <a href="https://github.com/braedonsaunders/sloppy">Sloppy</a> \u2014 relentless AI code cleanup</sub>\n</div>\n`;

  } else {
    // ===================== FIX MODE =====================
    const s = data as LoopState;
    const dur = s.passes.reduce((sum, p) => sum + p.durationMs, 0);
    const d = s.scoreAfter - s.scoreBefore;
    const sign = d >= 0 ? '+' : '';

    // ---- Hero header ----
    md += `<div align="center">\n\n`;
    md += `# \u{1F9F9} Sloppy \u2014 Fix Report\n\n`;

    // ---- Before / After score card ----
    md += `<table>\n<tr>\n`;
    md += `<td align="center" width="140">\n\n`;
    md += `${scoreEmoji(s.scoreBefore)}\n### ${s.scoreBefore}\n**Before**\n\n</td>\n`;
    md += `<td align="center" width="60">\n\n`;
    md += `### \u2192\n\n</td>\n`;
    md += `<td align="center" width="140">\n\n`;
    md += `${scoreEmoji(s.scoreAfter)}\n### ${s.scoreAfter}\n**After**\n\n</td>\n`;
    md += `<td align="center" width="120">\n\n`;
    md += `### ${sign}${d}\n**Delta**\n\n</td>\n`;
    md += `</tr>\n</table>\n\n`;
    md += `\`${progressBar(s.scoreAfter)}\` ${s.scoreAfter}/100 \u00B7 **${scoreGrade(s.scoreAfter)}**\n\n`;
    md += `</div>\n\n`;

    md += `---\n\n`;

    // ---- Key metrics row ----
    md += `### \u{1F4CA} Summary\n\n`;
    md += `<table>\n<tr>\n`;
    md += `<td align="center">\n\n**${s.totalFixed}**\n\n\u{1F527} Fixed\n\n</td>\n`;
    md += `<td align="center">\n\n**${s.totalSkipped}**\n\n\u23ED\uFE0F Skipped\n\n</td>\n`;
    md += `<td align="center">\n\n**${s.passes.length}**\n\n\u{1F504} Passes\n\n</td>\n`;
    md += `<td align="center">\n\n**${fmtDuration(dur)}**\n\n\u23F1\uFE0F Duration\n\n</td>\n`;
    md += `</tr>\n</table>\n\n`;

    if (d > 0) {
      md += `> [!IMPORTANT]\n`;
      md += `> Score improved by **${d} points** across **${s.passes.length} pass${s.passes.length !== 1 ? 'es' : ''}** in **${fmtDuration(dur)}**\n\n`;
    }

    // ---- Fixed issues by type ----
    if (s.totalFixed > 0) {
      const fixed = s.issues.filter(i => i.status === 'fixed');
      const byType = groupBy(fixed);
      const sortedTypes = Object.entries(byType).sort((a, b) => b[1].length - a[1].length);

      md += `### \u2705 Fixed Issues (${fixed.length})\n\n`;
      for (const [type, issues] of sortedTypes) {
        md += `<details open>\n<summary>${typeIcon(type)} <strong>${type}</strong> \u2014 ${issues.length} fixed</summary>\n\n`;
        md += `| | File | Issue | Commit |\n|:---:|:-----|:------|:-------|\n`;
        for (const i of issues) {
          const sha = i.commitSha?.slice(0, 7) || '-';
          md += `| ${severityIcon(i.severity)} | \`${i.file}:${i.line || '?'}\` | ${i.description} | \`${sha}\` |\n`;
        }
        md += `\n</details>\n\n`;
      }

      // ---- Mermaid chart ----
      md += `<details>\n<summary>\u{1F4C8} Fix Distribution Chart</summary>\n\n`;
      md += `\`\`\`mermaid\npie showData title Fixed by Category\n`;
      for (const [type, issues] of sortedTypes) {
        md += `    "${typeIcon(type)} ${type}" : ${issues.length}\n`;
      }
      md += `\`\`\`\n\n</details>\n\n`;
    }

    // ---- Skipped issues ----
    const skipped = s.issues.filter(i => i.status === 'skipped');
    if (skipped.length > 0) {
      md += `<details>\n<summary>\u23ED\uFE0F Skipped Issues (${skipped.length})</summary>\n\n`;
      md += `| | File | Issue | Reason |\n|:---:|:-----|:------|:-------|\n`;
      for (const i of skipped) {
        md += `| ${severityIcon(i.severity)} | \`${i.file}\` | ${i.description} | ${i.skipReason || '-'} |\n`;
      }
      md += `\n</details>\n\n`;
    }

    // ---- Pass breakdown with progress bars ----
    md += `<details>\n<summary>\u{1F504} Pass Breakdown</summary>\n\n`;
    md += `| Pass | Found | Fixed | Skipped | Duration | Progress |\n`;
    md += `|:----:|:-----:|:-----:|:-------:|:--------:|:---------|\n`;
    const maxFixed = Math.max(...s.passes.map(p => p.fixed), 1);
    for (const p of s.passes) {
      md += `| **${p.number}** | ${p.found} | ${p.fixed} | ${p.skipped} | ${fmtDuration(p.durationMs)} | \`${miniBar(p.fixed, maxFixed, 8)}\` |\n`;
    }
    md += `\n</details>\n\n`;

    // ---- Footer ----
    md += `---\n\n`;
    md += `<div align="center">\n<sub>\u{1F9F9} <a href="https://github.com/braedonsaunders/sloppy">Sloppy</a> \u2014 relentless AI code cleanup</sub>\n</div>\n`;
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

// --- Output File ---

export interface OutputFilePayload {
  version: 1;
  date: string;
  mode: 'scan' | 'fix';
  score: number;
  scoreBefore?: number;
  issues: Issue[];
}

export function writeOutputFile(
  filePath: string,
  issues: Issue[],
  mode: 'scan' | 'fix',
  score: number,
  scoreBefore?: number,
): string {
  const cwd = process.env.GITHUB_WORKSPACE || process.cwd();
  const resolved = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
  const dir = path.dirname(resolved);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const payload: OutputFilePayload = {
    version: 1,
    date: new Date().toISOString(),
    mode,
    score,
    ...(scoreBefore !== undefined && { scoreBefore }),
    issues,
  };

  fs.writeFileSync(resolved, JSON.stringify(payload, null, 2));
  core.info(`Issues written to ${resolved} (${issues.length} issues)`);
  return resolved;
}

export function loadOutputFile(filePath: string): Issue[] {
  const cwd = process.env.GITHUB_WORKSPACE || process.cwd();
  const resolved = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);

  if (!fs.existsSync(resolved)) return [];

  try {
    const raw = JSON.parse(fs.readFileSync(resolved, 'utf-8')) as OutputFilePayload;
    if (!raw.issues || !Array.isArray(raw.issues)) return [];
    return raw.issues;
  } catch {
    return [];
  }
}
