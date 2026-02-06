import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as fs from 'fs';
import * as path from 'path';
import { SloppyConfig, Issue, PassResult, LoopState, IssueType, Severity } from './types';
import { installAgent, runAgent } from './agent';
import { calculateScore } from './scan';
import { saveCheckpoint, loadCheckpoint } from './checkpoint';

const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

function sortBySeverity(issues: Issue[]): Issue[] {
  return [...issues].sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9));
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem > 0 ? `${m}m${rem}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return remM > 0 ? `${h}h${remM}m` : `${h}h`;
}

function formatTimeRemaining(deadline: number): string {
  return formatDuration(Math.max(0, deadline - Date.now()));
}

async function detectTestCommand(config: SloppyConfig): Promise<string> {
  if (config.testCommand) return config.testCommand;
  const cwd = process.env.GITHUB_WORKSPACE || process.cwd();

  if (fs.existsSync(path.join(cwd, 'package.json'))) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf-8'));
      if (pkg.scripts?.test && !pkg.scripts.test.includes('no test specified')) {
        return 'npm test';
      }
    } catch {}
  }
  if (fs.existsSync(path.join(cwd, 'Cargo.toml'))) return 'cargo test';
  if (fs.existsSync(path.join(cwd, 'go.mod'))) return 'go test ./...';
  if (fs.existsSync(path.join(cwd, 'pytest.ini')) || fs.existsSync(path.join(cwd, 'pyproject.toml'))) return 'python -m pytest';
  if (fs.existsSync(path.join(cwd, 'Makefile'))) return 'make test';
  return '';
}

async function runTests(cmd: string): Promise<boolean> {
  if (!cmd) return true;
  try {
    return (await exec.exec('sh', ['-c', cmd], { ignoreReturnCode: true, silent: true })) === 0;
  } catch {
    return false;
  }
}

async function gitCommit(issue: Issue): Promise<string> {
  const prefixes: Record<string, string> = {
    security: 'fix', bugs: 'fix', types: 'fix', lint: 'style',
    'dead-code': 'chore', stubs: 'fix', duplicates: 'refactor', coverage: 'test',
  };
  const prefix = prefixes[issue.type] || 'fix';
  const desc = issue.description.length > 60 ? issue.description.slice(0, 57) + '...' : issue.description;

  await exec.exec('git', ['add', '-A']);
  await exec.exec('git', ['commit', '-m', `${prefix}: ${desc}`], { ignoreReturnCode: true });

  let sha = '';
  await exec.exec('git', ['rev-parse', 'HEAD'], {
    listeners: { stdout: (d: Buffer) => { sha += d.toString().trim(); } },
  });
  return sha;
}

async function gitRevert(): Promise<void> {
  await exec.exec('git', ['checkout', '.'], { ignoreReturnCode: true });
  await exec.exec('git', ['clean', '-fd'], { ignoreReturnCode: true });
}

function scanPrompt(pass: number, previousFixes: string[], plan: string): string {
  const planSection = plan ? `\nQUALITY PLAN (from PLAN.md):\n${plan}\n` : '';

  if (pass === 1) {
    return `You are a senior code quality auditor performing a comprehensive codebase review.

TASK: Scan every file in this repository. Find all code quality issues.

ISSUE CATEGORIES (use these exact type values):
  security    — SQL injection, XSS, hardcoded secrets, auth bypass, path traversal, insecure crypto
  bugs        — null/undefined derefs, off-by-one, race conditions, wrong logic, unhandled errors
  types       — type mismatches, unsafe casts, missing generics, any-typed values, wrong return types
  lint        — unused vars/imports, inconsistent naming, missing returns, unreachable code
  dead-code   — functions/classes/exports never called or imported anywhere
  stubs       — TODO, FIXME, HACK, placeholder implementations, empty catch blocks, mock data
  duplicates  — copy-pasted logic that should be extracted to a shared function
  coverage    — public functions with zero test coverage, untested error paths, missing edge cases

SEVERITY LEVELS:
  critical — exploitable in production (data loss, auth bypass, RCE, credential leak)
  high     — will cause bugs in normal usage or data corruption
  medium   — code smell, maintainability risk, potential future bugs
  low      — style issue, minor improvement, naming consistency
${planSection}
RULES:
- Check EVERY file. Do not skip any directory.
- Only report REAL issues with specific file paths and line numbers.
- Do not invent issues. If code is clean, return empty issues array.
- Be precise: exact file, exact line, exact description of what's wrong.
- Prioritize: security > bugs > types > everything else.

Respond with ONLY valid JSON. No markdown. No code fences. No explanation.
{"issues":[{"type":"security|bugs|types|lint|dead-code|stubs|duplicates|coverage","severity":"critical|high|medium|low","file":"relative/path/to/file.ts","line":42,"description":"what is wrong and why it matters"}]}`;
  }

  return `You are a senior code quality auditor performing pass #${pass} of a multi-pass review.

PREVIOUS FIXES APPLIED:
${previousFixes.map(f => `  - ${f}`).join('\n')}

TASK: Scan the ENTIRE repository again with fresh eyes. Previous fixes often reveal new issues:
- Removing dead code exposes unused imports
- Fixing a type error reveals logic bugs underneath
- Refactoring may introduce new edge cases
- Previously-hidden code paths are now reachable
${planSection}
ISSUE CATEGORIES: security, bugs, types, lint, dead-code, stubs, duplicates, coverage
SEVERITY LEVELS: critical, high, medium, low

RULES:
- Do NOT re-report issues that were already fixed above.
- Look for NEW issues, especially ones revealed by the fixes.
- Check every file. Do not skip any directory.
- If the codebase is now clean, return {"issues":[]}.

Respond with ONLY valid JSON. No markdown. No code fences. No explanation.
{"issues":[{"type":"category","severity":"level","file":"relative/path","line":42,"description":"what is wrong"}]}`;
}

function fixPrompt(issue: Issue, testCommand: string): string {
  return `Fix this specific code quality issue. Make the MINIMAL change required.

ISSUE:
  Type: ${issue.type}
  Severity: ${issue.severity}
  File: ${issue.file}${issue.line ? ` (line ${issue.line})` : ''}
  Problem: ${issue.description}

RULES:
1. Fix ONLY this specific issue. Do not touch anything else.
2. Make the smallest possible change.
3. Do not add comments explaining the fix.
4. Do not reformat or restyle code you didn't change.
5. Do not add error handling beyond what's needed for this fix.
${testCommand ? `6. After fixing, run: ${testCommand}` : '6. Verify your fix compiles/parses correctly.'}

If this issue CANNOT be safely fixed without breaking other code, respond with exactly:
SKIP: <reason why it cannot be fixed>`;
}

function parseIssues(output: string): Issue[] {
  try {
    let text = output;
    // Handle Claude Code JSON wrapper
    try {
      const parsed = JSON.parse(text);
      if (parsed.result) text = parsed.result;
      else if (typeof parsed === 'string') text = parsed;
    } catch {}

    const match = text.match(/\{[\s\S]*"issues"[\s\S]*\}/);
    if (!match) return [];

    const data = JSON.parse(match[0]);
    return (data.issues || []).map((raw: any, i: number) => ({
      id: `fix-${Date.now()}-${i}`,
      type: (raw.type || 'lint') as IssueType,
      severity: (raw.severity || 'medium') as Severity,
      file: raw.file || 'unknown',
      line: raw.line,
      description: raw.description || '',
      status: 'found' as const,
    }));
  } catch {
    core.warning('Failed to parse agent scan output');
    return [];
  }
}

export async function runFixLoop(config: SloppyConfig): Promise<LoopState> {
  const startTime = Date.now();
  const checkpoint = loadCheckpoint();

  const state: LoopState = checkpoint || {
    runId: `sloppy-${Date.now()}`,
    pass: 0,
    chainNumber: parseInt(core.getInput('chain_number') || '0'),
    branchName: '',
    issues: [],
    passes: [],
    totalFixed: 0,
    totalSkipped: 0,
    startTime: new Date().toISOString(),
    scoreBefore: 0,
    scoreAfter: 0,
    complete: false,
  };

  const deadline = startTime + config.timeout;
  const margin = 2 * 60 * 1000; // 2 min safety margin

  // Header
  core.info('');
  core.info('='.repeat(50));
  core.info('SLOPPY FIX MODE');
  core.info('='.repeat(50));
  core.info(`Agent:      ${config.agent}`);
  core.info(`Model:      ${config.model || 'default'}`);
  core.info(`Timeout:    ${formatDuration(config.timeout)}`);
  core.info(`Max passes: ${config.maxPasses}`);
  core.info(`Chain:      ${state.chainNumber}/${config.maxChains}`);
  core.info('='.repeat(50));
  core.info('');

  // Install agent
  core.info(`Installing ${config.agent} CLI...`);
  await installAgent(config.agent);
  core.info(`${config.agent} CLI installed.`);

  // Setup git
  await exec.exec('git', ['config', 'user.name', 'sloppy[bot]']);
  await exec.exec('git', ['config', 'user.email', 'sloppy[bot]@users.noreply.github.com']);

  // Create or checkout branch
  if (!state.branchName) {
    state.branchName = `sloppy/fix-${new Date().toISOString().slice(0, 10)}-${state.runId.slice(-6)}`;
    await exec.exec('git', ['checkout', '-b', state.branchName], { ignoreReturnCode: true });
    core.info(`Created branch: ${state.branchName}`);
  } else {
    await exec.exec('git', ['checkout', state.branchName], { ignoreReturnCode: true });
    core.info(`Resumed branch: ${state.branchName}`);
  }

  // Detect test command
  const testCmd = await detectTestCommand(config);
  if (testCmd) {
    core.info(`Test command: ${testCmd}`);
  } else {
    core.info('No test command detected (fixes won\'t be test-verified)');
  }

  // Load PLAN.md if it exists
  const cwd = process.env.GITHUB_WORKSPACE || process.cwd();
  let plan = '';
  const planPath = path.join(cwd, 'PLAN.md');
  if (fs.existsSync(planPath)) {
    plan = fs.readFileSync(planPath, 'utf-8').slice(0, 4000);
    core.info('Loaded PLAN.md for quality context');
  }

  core.info('');

  // --- THE RELENTLESS LOOP ---
  while (Date.now() < deadline - margin && state.pass < config.maxPasses) {
    state.pass++;
    const passStart = Date.now();

    core.info('');
    core.info('='.repeat(50));
    core.info(`PASS ${state.pass}/${config.maxPasses}  |  Time remaining: ${formatTimeRemaining(deadline)}  |  Fixed so far: ${state.totalFixed}`);
    core.info('='.repeat(50));

    // Gather previous fixes for context
    const prevFixes = state.issues
      .filter(i => i.status === 'fixed')
      .slice(-20)
      .map(i => `[${i.type}] ${i.file}: ${i.description}`);

    // SCAN
    core.info('');
    core.info(`Scanning repository (${config.agent})...`);
    const scanStart = Date.now();
    const scanResult = await runAgent(config.agent, scanPrompt(state.pass, prevFixes, plan), {
      maxTurns: 30,
      model: config.model || undefined,
      timeout: Math.min(5 * 60 * 1000, deadline - Date.now() - margin),
    });
    const scanDuration = formatDuration(Date.now() - scanStart);

    const found = parseIssues(scanResult.output);
    core.info(`Scan complete (${scanDuration}): found ${found.length} issues`);

    if (found.length > 0) {
      // Log issue summary
      const bySev: Record<string, number> = {};
      for (const issue of found) {
        bySev[issue.severity] = (bySev[issue.severity] || 0) + 1;
      }
      const sevSummary = Object.entries(bySev)
        .sort(([a], [b]) => (SEVERITY_ORDER[a] ?? 9) - (SEVERITY_ORDER[b] ?? 9))
        .map(([sev, count]) => `${count} ${sev}`)
        .join(', ');
      core.info(`Breakdown: ${sevSummary}`);
    }

    // Check if done
    if (found.length === 0 && state.pass >= config.minPasses) {
      core.info('');
      core.info('Repository is CLEAN. Verified across multiple passes.');
      state.complete = true;
      state.passes.push({ number: state.pass, found: 0, fixed: 0, skipped: 0, durationMs: Date.now() - passStart });
      break;
    }

    if (found.length === 0) {
      core.info(`No issues found, but need ${config.minPasses - state.pass + 1} more clean pass(es) to verify.`);
      state.passes.push({ number: state.pass, found: 0, fixed: 0, skipped: 0, durationMs: Date.now() - passStart });
      continue;
    }

    // FIX each issue atomically
    const sorted = sortBySeverity(found);
    let passFixed = 0;
    let passSkipped = 0;

    core.info('');
    core.info(`Fixing ${sorted.length} issues (highest severity first)...`);
    core.info('');

    for (let idx = 0; idx < sorted.length; idx++) {
      const issue = sorted[idx];
      if (Date.now() >= deadline - margin) {
        core.info('');
        core.warning(`Timeout approaching — stopping after ${idx} of ${sorted.length} issues`);
        break;
      }

      const timeLeft = formatTimeRemaining(deadline);
      core.info(`  [${idx + 1}/${sorted.length}] (${timeLeft} left) ${issue.severity.toUpperCase()} ${issue.type} — ${issue.file}:${issue.line || '?'}`);
      core.info(`    ${issue.description}`);

      const fixStart = Date.now();
      const result = await runAgent(config.agent, fixPrompt(issue, testCmd), {
        maxTurns: 15,
        model: config.model || undefined,
        timeout: Math.min(3 * 60 * 1000, deadline - Date.now() - margin),
      });
      const fixDuration = formatDuration(Date.now() - fixStart);

      if (result.output.includes('SKIP:') || result.exitCode !== 0) {
        issue.status = 'skipped';
        issue.skipReason = result.output.match(/SKIP:\s*(.*)/)?.[1] || 'Agent could not fix';
        passSkipped++;
        state.totalSkipped++;
        await gitRevert();
        core.info(`    -> SKIPPED (${fixDuration}): ${issue.skipReason}`);
      } else if (await runTests(testCmd)) {
        const sha = await gitCommit(issue);
        issue.status = 'fixed';
        issue.commitSha = sha;
        passFixed++;
        state.totalFixed++;
        core.info(`    -> FIXED ${sha.slice(0, 7)} (${fixDuration})`);
      } else {
        issue.status = 'skipped';
        issue.skipReason = 'Tests failed after fix';
        passSkipped++;
        state.totalSkipped++;
        await gitRevert();
        core.info(`    -> REVERTED (${fixDuration}): tests failed`);
      }

      state.issues.push(issue);
    }

    state.passes.push({
      number: state.pass,
      found: found.length,
      fixed: passFixed,
      skipped: passSkipped,
      durationMs: Date.now() - passStart,
    });

    core.info('');
    core.info('-'.repeat(50));
    core.info(`Pass ${state.pass} summary: ${found.length} found, ${passFixed} fixed, ${passSkipped} skipped (${formatDuration(Date.now() - passStart)})`);
    core.info(`Running totals: ${state.totalFixed} fixed, ${state.totalSkipped} skipped`);
    core.info('-'.repeat(50));

    saveCheckpoint(state);
  }

  // Calculate scores
  const allFound = state.issues;
  const remaining = allFound.filter(i => i.status !== 'fixed');
  state.scoreAfter = calculateScore(remaining);
  if (state.scoreBefore === 0) state.scoreBefore = calculateScore(allFound);

  // Push branch
  if (state.totalFixed > 0) {
    core.info('');
    core.info(`Pushing ${state.totalFixed} fixes on ${state.branchName}...`);
    const token = process.env.GITHUB_TOKEN || '';
    const repo = process.env.GITHUB_REPOSITORY || '';
    const remote = `https://x-access-token:${token}@github.com/${repo}.git`;
    await exec.exec('git', ['push', remote, state.branchName, '--force'], { ignoreReturnCode: true });
    core.info('Push complete.');
  }

  // Final summary
  core.info('');
  core.info('='.repeat(50));
  core.info('SLOPPY FIX COMPLETE');
  core.info('='.repeat(50));
  core.info(`Score:    ${state.scoreBefore} -> ${state.scoreAfter}`);
  core.info(`Fixed:    ${state.totalFixed}`);
  core.info(`Skipped:  ${state.totalSkipped}`);
  core.info(`Passes:   ${state.passes.length}`);
  core.info(`Duration: ${formatDuration(Date.now() - startTime)}`);
  core.info(`Complete: ${state.complete ? 'YES' : 'NO (more work may remain)'}`);
  core.info('='.repeat(50));

  saveCheckpoint(state);
  return state;
}
