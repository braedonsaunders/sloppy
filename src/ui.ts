import * as core from '@actions/core';

// ---------------------------------------------------------------------------
// ANSI styling — GitHub Actions supports ANSI but resets styles on every
// newline, so each line must be self-contained with its own escape codes.
// ---------------------------------------------------------------------------

const ESC = '\x1b';

const S = {
  reset: `${ESC}[0m`,
  bold: `${ESC}[1m`,
  dim: `${ESC}[2m`,
  red: `${ESC}[31m`,
  green: `${ESC}[32m`,
  yellow: `${ESC}[33m`,
  blue: `${ESC}[34m`,
  magenta: `${ESC}[35m`,
  cyan: `${ESC}[36m`,
  white: `${ESC}[37m`,
  gray: `${ESC}[90m`,
  brightGreen: `${ESC}[92m`,
  brightYellow: `${ESC}[93m`,
  brightCyan: `${ESC}[96m`,
  brightWhite: `${ESC}[97m`,
};

// Apply ANSI styles to text. Must call on every line.
function c(text: string, ...styles: string[]): string {
  if (!styles.length) return text;
  return styles.join('') + text + S.reset;
}

// ---------------------------------------------------------------------------
// Unicode symbols (NOT emoji — these render reliably in monospace fonts)
// ---------------------------------------------------------------------------

export const SYM = {
  check: '\u2713',     // ✓
  cross: '\u2717',     // ✗
  bullet: '\u25CF',    // ●
  diamond: '\u25C6',   // ◆
  arrow: '\u25B8',     // ▸
  bar: '\u2588',       // █
  barLight: '\u2591',  // ░
  dash: '\u2500',      // ─
  doubleDash: '\u2550', // ═
  vline: '\u2502',     // │
  teeRight: '\u251C',  // ├
  cornerRight: '\u2514', // └
  dotted: '\u2504',    // ┄
};

// ---------------------------------------------------------------------------
// Layout primitives
// ---------------------------------------------------------------------------

const W = 64; // Standard width for dividers

export function divider(char = SYM.doubleDash): string {
  return c(char.repeat(W), S.cyan);
}

export function thinDivider(): string {
  return c(SYM.dash.repeat(W), S.gray);
}

export function blank(): void {
  core.info('');
}

// ---------------------------------------------------------------------------
// Banner — the main header block
// ---------------------------------------------------------------------------

export function banner(title: string, subtitle?: string): void {
  core.info(divider());
  core.info(c(`  ${title}`, S.bold, S.brightWhite));
  if (subtitle) {
    core.info(c(`  ${subtitle}`, S.gray));
  }
  core.info(divider());
}

// ---------------------------------------------------------------------------
// Section headers
// ---------------------------------------------------------------------------

export function section(title: string): void {
  const padded = ` ${title} `;
  const remaining = Math.max(0, W - padded.length - 2);
  const line = SYM.dash.repeat(2) + padded + SYM.dash.repeat(remaining);
  blank();
  core.info(c(line, S.bold, S.cyan));
}

// ---------------------------------------------------------------------------
// Key-value pairs (aligned)
// ---------------------------------------------------------------------------

export function kv(key: string, value: string, indent = 2): void {
  const pad = ' '.repeat(indent);
  const keyPad = key.padEnd(14);
  core.info(`${pad}${c(keyPad, S.gray)}${value}`);
}

// ---------------------------------------------------------------------------
// Status indicators for fix results
// ---------------------------------------------------------------------------

export function fixed(file: string, desc: string, sha?: string): void {
  const shaStr = sha ? c(` ${sha.slice(0, 7)}`, S.gray) : '';
  core.info(`  ${c(SYM.check, S.bold, S.green)} ${c('FIXED', S.bold, S.green)}${shaStr}  ${file} ${c(SYM.dash, S.gray)} ${desc}`);
}

export function skipped(file: string, desc: string, reason?: string, duration?: string): void {
  const dur = duration ? c(` (${duration})`, S.gray) : '';
  const rsn = reason ? c(`: ${reason}`, S.gray) : '';
  core.info(`  ${c(SYM.cross, S.yellow)} ${c('SKIP', S.yellow)}${dur}  ${file} ${c(SYM.dash, S.gray)} ${desc}${rsn}`);
}

export function issueFound(file: string, line: number | undefined, desc: string, severity: string, type: string): void {
  const sevColor = severity === 'critical' || severity === 'high' ? S.red
    : severity === 'medium' ? S.yellow
    : S.gray;
  const lineStr = line ? `:${line}` : '';
  core.info(`  ${c(SYM.bullet, sevColor)} ${c(`[${severity}/${type}]`, sevColor)} ${file}${lineStr} ${c(SYM.dash, S.gray)} ${desc}`);
}

// ---------------------------------------------------------------------------
// Severity breakdown
// ---------------------------------------------------------------------------

export function severityBreakdown(counts: Record<string, number>): void {
  const order = ['critical', 'high', 'medium', 'low'];
  const parts: string[] = [];
  for (const sev of order) {
    const n = counts[sev] || 0;
    if (n === 0) continue;
    const col = sev === 'critical' ? S.red
      : sev === 'high' ? S.red
      : sev === 'medium' ? S.yellow
      : S.gray;
    parts.push(`${c(SYM.bullet, col)} ${c(String(n), S.bold)} ${sev}`);
  }
  if (parts.length > 0) {
    core.info(`  ${parts.join('   ')}`);
  }
}

// ---------------------------------------------------------------------------
// Progress bar
// ---------------------------------------------------------------------------

export function progressBar(current: number, total: number, width = 30, label?: string): string {
  const pct = total > 0 ? current / total : 0;
  const filled = Math.round(pct * width);
  const empty = width - filled;
  const bar = c(SYM.bar.repeat(filled), S.green) + c(SYM.barLight.repeat(empty), S.gray);
  const pctStr = c(`${Math.round(pct * 100)}%`, S.bold);
  const lbl = label ? `  ${c(label, S.gray)}` : '';
  return `  ${bar}  ${pctStr}${lbl}`;
}

// ---------------------------------------------------------------------------
// Cluster display
// ---------------------------------------------------------------------------

export function clusterHeader(idx: number, total: number, dir: string, issueCount: number): void {
  core.info(`  ${c(`[${idx}/${total}]`, S.bold, S.cyan)} ${c(dir, S.bold)}${c(`/`, S.gray)} ${c(`(${issueCount} issue${issueCount !== 1 ? 's' : ''})`, S.gray)}`);
}

// ---------------------------------------------------------------------------
// Tree structure for agent output
// ---------------------------------------------------------------------------

export function treeItem(text: string, isLast: boolean): void {
  const prefix = isLast ? SYM.cornerRight : SYM.teeRight;
  core.info(`    ${c(prefix + SYM.dash, S.gray)} ${text}`);
}

// ---------------------------------------------------------------------------
// Score display
// ---------------------------------------------------------------------------

export function scoreChange(before: number, after: number): void {
  const diff = after - before;
  const diffStr = diff > 0 ? c(`(+${diff})`, S.bold, S.green)
    : diff < 0 ? c(`(${diff})`, S.red)
    : c('(no change)', S.gray);
  core.info(`  ${c('Score', S.gray).padEnd(28)}${c(String(before), S.dim)} ${c(SYM.arrow, S.cyan)} ${c(String(after), S.bold, S.brightWhite)}  ${diffStr}`);
}

export function score(value: number, label = 'Score'): void {
  const col = value >= 80 ? S.green : value >= 50 ? S.yellow : S.red;
  core.info(`  ${c(label.padEnd(14), S.gray)}${c(`${value}/100`, S.bold, col)}`);
}

// ---------------------------------------------------------------------------
// Stat line
// ---------------------------------------------------------------------------

export function stat(label: string, value: string | number): void {
  core.info(`  ${c(label.padEnd(14), S.gray)}${c(String(value), S.brightWhite)}`);
}

// ---------------------------------------------------------------------------
// Agent streaming output helpers
// ---------------------------------------------------------------------------

export function agentText(text: string): void {
  core.info(c(`  ${SYM.vline} ${text}`, S.dim));
}

export function agentTool(name: string): void {
  core.info(`  ${c(SYM.vline, S.gray)} ${c(`[tool: ${name}]`, S.blue)}`);
}

export function agentToolProgress(name: string, elapsed: number): void {
  core.info(`  ${c(SYM.vline, S.gray)} ${c(`${SYM.arrow} ${name}`, S.blue)} ${c(`${elapsed}s`, S.gray)}`);
}

export function agentToolSummary(summary: string): void {
  const preview = summary.length > 200 ? summary.slice(0, 200) + '...' : summary;
  core.info(`  ${c(SYM.vline, S.gray)} ${preview}`);
}

export function agentSystem(subtype: string): void {
  core.info(`  ${c(SYM.vline, S.gray)} ${c(`[${subtype}]`, S.magenta)}`);
}

export function agentResult(subtype: string, turns: number, cost?: number): void {
  const costStr = cost ? c(` $${cost.toFixed(3)}`, S.gray) : '';
  core.info(`  ${c(SYM.vline, S.gray)} ${c(`[result: ${subtype}, ${turns} turns${costStr ? ',' : ''}${costStr}]`, S.cyan)}`);
}

export function agentHeartbeat(elapsed: number, events: number): void {
  core.info(c(`  ${SYM.dotted} agent running (${elapsed}s, ${events} events)`, S.gray));
}

export function agentStreamStart(elapsed: number, bytes: number): void {
  core.info(`  ${c(SYM.vline, S.gray)} ${c(`stream started after ${elapsed}s (${bytes} bytes)`, S.gray)}`);
}

export function agentDone(elapsed: number, events: number): void {
  core.info(`  ${c(SYM.check, S.green)} ${c(`Agent finished in ${elapsed}s (${events} events)`, S.gray)}`);
}

export function agentStderr(line: string): void {
  core.info(`  ${c(SYM.vline, S.red)} ${c(line, S.red)}`);
}

// ---------------------------------------------------------------------------
// Groups (collapsible sections in GitHub Actions)
// ---------------------------------------------------------------------------

export function startGroup(name: string): void {
  core.startGroup(name);
}

export function endGroup(): void {
  core.endGroup();
}

// ---------------------------------------------------------------------------
// Pass summary block
// ---------------------------------------------------------------------------

export function passSummary(pass: number, fixedCount: number, skippedCount: number, duration: string): void {
  core.info(thinDivider());
  core.info(`  ${c(`Pass ${pass}`, S.bold)}  ${c(SYM.check, S.green)} ${c(String(fixedCount), S.bold, S.green)} fixed  ${c(SYM.cross, S.yellow)} ${c(String(skippedCount), S.yellow)} skipped  ${c(SYM.diamond, S.gray)} ${c(duration, S.gray)}`);
}

// ---------------------------------------------------------------------------
// Final results block
// ---------------------------------------------------------------------------

export function finalResults(): void {
  blank();
  core.info(divider());
  core.info(c('  R E S U L T S', S.bold, S.brightWhite));
  core.info(divider());
}

export { S, c };
