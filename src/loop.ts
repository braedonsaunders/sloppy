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
  const planSection = plan ? `\n\nReference this quality plan:\n${plan}\n` : '';

  if (pass === 1) {
    return `Scan this ENTIRE repository. Check EVERY file. Find ALL code quality issues.

Look for: security vulnerabilities, bugs, type errors, lint violations, dead code, TODOs/stubs, code duplication, missing test coverage.

Be EXHAUSTIVE. Miss NOTHING.${planSection}

Respond ONLY with valid JSON (no markdown fences):
{"issues":[{"type":"security|bugs|types|lint|dead-code|stubs|duplicates|coverage","severity":"critical|high|medium|low","file":"relative/path","line":0,"description":"brief description"}]}`;
  }

  return `Previous pass fixed:
${previousFixes.map(f => `- ${f}`).join('\n')}

Scan the ENTIRE repository AGAIN. Fixing things reveals new things:
- Removing dead code exposes unused imports
- Fixing a type error reveals logic bugs underneath
- Refactoring may introduce edge cases

Look DEEPER. What did you miss? What did fixes reveal?${planSection}

Respond ONLY with valid JSON (no markdown fences):
{"issues":[{"type":"security|bugs|types|lint|dead-code|stubs|duplicates|coverage","severity":"critical|high|medium|low","file":"relative/path","line":0,"description":"brief description"}]}`;
}

function fixPrompt(issue: Issue, testCommand: string): string {
  return `Fix this SPECIFIC issue and ONLY this issue. MINIMAL change.

Issue: ${issue.description}
File: ${issue.file}${issue.line ? `:${issue.line}` : ''}
Type: ${issue.type} | Severity: ${issue.severity}

Rules:
- Fix ONLY this issue
- Smallest possible change
- No added comments
- No reformatting unchanged code
${testCommand ? `- Run tests after: ${testCommand}` : '- Verify fix is correct'}

If the issue cannot be safely fixed, respond with "SKIP: reason".`;
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

  // Install agent
  await installAgent(config.agent);

  // Setup git
  await exec.exec('git', ['config', 'user.name', 'sloppy[bot]']);
  await exec.exec('git', ['config', 'user.email', 'sloppy[bot]@users.noreply.github.com']);

  // Create or checkout branch
  if (!state.branchName) {
    state.branchName = `sloppy/fix-${new Date().toISOString().slice(0, 10)}-${state.runId.slice(-6)}`;
    await exec.exec('git', ['checkout', '-b', state.branchName], { ignoreReturnCode: true });
  } else {
    await exec.exec('git', ['checkout', state.branchName], { ignoreReturnCode: true });
  }

  // Detect test command
  const testCmd = await detectTestCommand(config);
  if (testCmd) core.info(`Test command: ${testCmd}`);

  // Load PLAN.md if it exists
  const cwd = process.env.GITHUB_WORKSPACE || process.cwd();
  let plan = '';
  const planPath = path.join(cwd, 'PLAN.md');
  if (fs.existsSync(planPath)) {
    plan = fs.readFileSync(planPath, 'utf-8').slice(0, 4000);
  }

  const deadline = startTime + config.timeout;
  const margin = 2 * 60 * 1000; // 2 min safety margin

  // --- THE RELENTLESS LOOP ---
  while (Date.now() < deadline - margin && state.pass < config.maxPasses) {
    state.pass++;
    const passStart = Date.now();

    core.info(`\n${'='.repeat(50)}`);
    core.info(`PASS ${state.pass}`);
    core.info('='.repeat(50));

    // Gather previous fixes for context
    const prevFixes = state.issues
      .filter(i => i.status === 'fixed')
      .slice(-20)
      .map(i => `[${i.type}] ${i.file}: ${i.description}`);

    // SCAN
    core.info('Scanning...');
    const scanResult = await runAgent(config.agent, scanPrompt(state.pass, prevFixes, plan), {
      maxTurns: 30,
      model: config.model || undefined,
      timeout: Math.min(5 * 60 * 1000, deadline - Date.now() - margin),
    });

    const found = parseIssues(scanResult.output);
    core.info(`Found ${found.length} issues`);

    // Check if done
    if (found.length === 0 && state.pass >= config.minPasses) {
      core.info('Repository is clean. Verified across multiple passes.');
      state.complete = true;
      state.passes.push({ number: state.pass, found: 0, fixed: 0, skipped: 0, durationMs: Date.now() - passStart });
      break;
    }

    if (found.length === 0) {
      core.info(`No issues but min passes (${config.minPasses}) not reached yet.`);
      state.passes.push({ number: state.pass, found: 0, fixed: 0, skipped: 0, durationMs: Date.now() - passStart });
      continue;
    }

    // FIX each issue atomically
    const sorted = sortBySeverity(found);
    let passFixed = 0;
    let passSkipped = 0;

    for (const issue of sorted) {
      if (Date.now() >= deadline - margin) {
        core.info('Approaching timeout, stopping this pass');
        break;
      }

      core.info(`  [${issue.severity}] ${issue.type} — ${issue.file}: ${issue.description}`);

      const result = await runAgent(config.agent, fixPrompt(issue, testCmd), {
        maxTurns: 15,
        model: config.model || undefined,
        timeout: Math.min(3 * 60 * 1000, deadline - Date.now() - margin),
      });

      if (result.output.includes('SKIP:') || result.exitCode !== 0) {
        issue.status = 'skipped';
        issue.skipReason = result.output.match(/SKIP:\s*(.*)/)?.[1] || 'Agent could not fix';
        passSkipped++;
        state.totalSkipped++;
        await gitRevert();
        core.info(`    SKIPPED: ${issue.skipReason}`);
      } else if (await runTests(testCmd)) {
        const sha = await gitCommit(issue);
        issue.status = 'fixed';
        issue.commitSha = sha;
        passFixed++;
        state.totalFixed++;
        core.info(`    FIXED (${sha.slice(0, 7)})`);
      } else {
        issue.status = 'skipped';
        issue.skipReason = 'Tests failed after fix';
        passSkipped++;
        state.totalSkipped++;
        await gitRevert();
        core.info('    REVERTED: tests failed');
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

    core.info(`Pass ${state.pass}: found=${found.length} fixed=${passFixed} skipped=${passSkipped}`);
    saveCheckpoint(state);
  }

  // Calculate scores
  const allFound = state.issues;
  const remaining = allFound.filter(i => i.status !== 'fixed');
  state.scoreAfter = calculateScore(remaining);
  if (state.scoreBefore === 0) state.scoreBefore = calculateScore(allFound);

  // Push branch
  if (state.totalFixed > 0) {
    core.info(`Pushing ${state.totalFixed} fixes on ${state.branchName}...`);
    const token = process.env.GITHUB_TOKEN || '';
    const repo = process.env.GITHUB_REPOSITORY || '';
    const remote = `https://x-access-token:${token}@github.com/${repo}.git`;
    await exec.exec('git', ['push', remote, state.branchName, '--force'], { ignoreReturnCode: true });
  }

  saveCheckpoint(state);
  return state;
}
