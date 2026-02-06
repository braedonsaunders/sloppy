import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SloppyConfig, Issue, PassResult, LoopState, IssueType, Severity, PluginContext } from './types';
import { installAgent, runAgent } from './agent';
import { calculateScore, collectFiles, countSourceLOC } from './scan';
import { saveCheckpoint, loadCheckpoint } from './checkpoint';
import { loadOutputFile, writeOutputFile } from './report';
import { runHook, applyFilters, formatCustomPromptSection, applyAllowRules } from './plugins';
import * as ui from './ui';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Test detection — covers major ecosystems
// ---------------------------------------------------------------------------

async function detectTestCommand(config: SloppyConfig): Promise<string> {
  if (config.testCommand) return config.testCommand;
  const cwd = process.env.GITHUB_WORKSPACE || process.cwd();

  // Node.js
  if (fs.existsSync(path.join(cwd, 'package.json'))) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf-8'));
      if (pkg.scripts?.test && !pkg.scripts.test.includes('no test specified')) {
        return 'npm test';
      }
    } catch {}
  }
  // Rust
  if (fs.existsSync(path.join(cwd, 'Cargo.toml'))) return 'cargo test';
  // Go
  if (fs.existsSync(path.join(cwd, 'go.mod'))) return 'go test ./...';
  // Python
  if (fs.existsSync(path.join(cwd, 'pytest.ini')) || fs.existsSync(path.join(cwd, 'pyproject.toml'))) return 'python -m pytest';
  // Java / Kotlin (Gradle)
  if (fs.existsSync(path.join(cwd, 'build.gradle')) || fs.existsSync(path.join(cwd, 'build.gradle.kts'))) return './gradlew test';
  // Java (Maven)
  if (fs.existsSync(path.join(cwd, 'pom.xml'))) return 'mvn test';
  // Ruby
  if (fs.existsSync(path.join(cwd, 'Gemfile'))) {
    if (fs.existsSync(path.join(cwd, 'spec'))) return 'bundle exec rspec';
    if (fs.existsSync(path.join(cwd, 'test'))) return 'bundle exec rake test';
  }
  // PHP
  if (fs.existsSync(path.join(cwd, 'phpunit.xml')) || fs.existsSync(path.join(cwd, 'phpunit.xml.dist'))) return 'vendor/bin/phpunit';
  // Elixir
  if (fs.existsSync(path.join(cwd, 'mix.exs'))) return 'mix test';
  // Makefile fallback
  if (fs.existsSync(path.join(cwd, 'Makefile'))) return 'make test';

  return '';
}

async function runTests(cmd: string, cwd?: string): Promise<boolean> {
  if (!cmd) return true;
  try {
    const opts: exec.ExecOptions = { ignoreReturnCode: true, silent: true };
    if (cwd) opts.cwd = cwd;
    return (await exec.exec('sh', ['-c', cmd], opts)) === 0;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Git operations
// ---------------------------------------------------------------------------

async function gitCommit(issue: Issue, cwd?: string): Promise<string> {
  const prefixes: Record<string, string> = {
    security: 'fix', bugs: 'fix', types: 'fix', lint: 'style',
    'dead-code': 'chore', stubs: 'fix', duplicates: 'refactor', coverage: 'test',
  };
  const prefix = prefixes[issue.type] || 'fix';
  const desc = issue.description.length > 60 ? issue.description.slice(0, 57) + '...' : issue.description;

  const execOpts: exec.ExecOptions = { ignoreReturnCode: true };
  if (cwd) execOpts.cwd = cwd;

  await exec.exec('git', ['add', '-A'], execOpts);
  await exec.exec('git', ['commit', '-m', `${prefix}: ${desc}`], execOpts);

  let sha = '';
  await exec.exec('git', ['rev-parse', 'HEAD'], {
    ...execOpts,
    listeners: { stdout: (d: Buffer) => { sha += d.toString().trim(); } },
  });
  return sha;
}

async function gitRevert(cwd?: string): Promise<void> {
  const execOpts: exec.ExecOptions = { ignoreReturnCode: true };
  if (cwd) execOpts.cwd = cwd;
  await exec.exec('git', ['checkout', '.'], execOpts);
  await exec.exec('git', ['clean', '-fd'], execOpts);
}

async function gitHasChanges(cwd?: string): Promise<boolean> {
  let stdout = '';
  const execOpts: exec.ExecOptions = {
    ignoreReturnCode: true,
    listeners: { stdout: (d: Buffer) => { stdout += d.toString(); } },
    silent: true,
  };
  if (cwd) execOpts.cwd = cwd;
  await exec.exec('git', ['status', '--porcelain'], execOpts);
  return stdout.trim().length > 0;
}

async function gitPushBranch(branchName: string): Promise<boolean> {
  const token = process.env.GITHUB_TOKEN || '';
  const repo = process.env.GITHUB_REPOSITORY || '';
  if (!token || !repo || !branchName) return false;
  const remote = `https://x-access-token:${token}@github.com/${repo}.git`;
  const exitCode = await exec.exec('git', ['push', remote, branchName, '--force'], {
    ignoreReturnCode: true,
    silent: true,
  });
  return exitCode === 0;
}

async function gitHead(cwd?: string): Promise<string> {
  let sha = '';
  const execOpts: exec.ExecOptions = {
    ignoreReturnCode: true,
    listeners: { stdout: (d: Buffer) => { sha += d.toString().trim(); } },
    silent: true,
  };
  if (cwd) execOpts.cwd = cwd;
  await exec.exec('git', ['rev-parse', 'HEAD'], execOpts);
  return sha;
}

// When the agent times out or errors without producing structured JSON output,
// fall back to checking what files were actually committed. The fix prompt
// instructs the agent to commit each fix individually, so we can infer which
// issues were fixed by comparing HEAD before and after the agent run.
async function inferFixedFromGit(
  cluster: IssueCluster,
  headBefore: string,
  cwd?: string,
): Promise<{ fixed: Issue[]; skipped: Issue[] } | null> {
  const headAfter = await gitHead(cwd);
  if (!headAfter || headAfter === headBefore) return null;

  let filesOutput = '';
  const execOpts: exec.ExecOptions = {
    listeners: { stdout: (d: Buffer) => { filesOutput += d.toString(); } },
    silent: true,
    ignoreReturnCode: true,
  };
  if (cwd) execOpts.cwd = cwd;
  await exec.exec('git', ['diff', '--name-only', headBefore, headAfter], execOpts);

  const changedFiles = new Set(filesOutput.trim().split('\n').filter(f => f.trim()));
  if (changedFiles.size === 0) return null;

  const fixed: Issue[] = [];
  const skipped: Issue[] = [];

  for (const issue of cluster.issues) {
    if (changedFiles.has(issue.file)) {
      issue.status = 'fixed';
      fixed.push(issue);
    } else {
      issue.status = 'skipped';
      issue.skipReason = 'Agent did not modify this file';
      skipped.push(issue);
    }
  }

  return fixed.length > 0 ? { fixed, skipped } : null;
}

// ---------------------------------------------------------------------------
// Issue clustering — groups related issues for efficient multi-fix dispatch
// ---------------------------------------------------------------------------

interface IssueCluster {
  id: string;
  directory: string;
  issues: Issue[];
  files: string[];
}

/**
 * Cluster issues by directory proximity. Issues in the same directory
 * or sharing a common parent are grouped together. This produces one
 * agent call per cluster instead of one per issue.
 */
function clusterIssues(issues: Issue[], maxPerCluster: number = 10): IssueCluster[] {
  // Group by top-level directory (first path segment)
  const byDir = new Map<string, Issue[]>();
  for (const issue of issues) {
    const parts = issue.file.split('/');
    const dir = parts.length > 1 ? parts[0] : '.';
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir)!.push(issue);
  }

  const clusters: IssueCluster[] = [];
  let id = 0;

  for (const [dir, dirIssues] of byDir) {
    // If too many issues in one dir, split into sub-clusters
    const sorted = sortBySeverity(dirIssues);
    for (let i = 0; i < sorted.length; i += maxPerCluster) {
      const batch = sorted.slice(i, i + maxPerCluster);
      const files = [...new Set(batch.map(iss => iss.file))];
      clusters.push({
        id: `cluster-${id++}`,
        directory: dir,
        issues: batch,
        files,
      });
    }
  }

  // Sort clusters: most critical issues first
  clusters.sort((a, b) => {
    const aSev = Math.min(...a.issues.map(i => SEVERITY_ORDER[i.severity] ?? 9));
    const bSev = Math.min(...b.issues.map(i => SEVERITY_ORDER[i.severity] ?? 9));
    return aSev - bSev;
  });

  return clusters;
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

function scanPrompt(pass: number, previousFixes: string[], plan: string, customSection: string): string {
  const planSection = plan ? `\nQUALITY PLAN (from PLAN.md):\n${plan}\n` : '';

  if (pass === 1) {
    return `You are a senior code quality auditor performing a comprehensive codebase review.

TASK: Scan every file in this repository. Find all code quality issues.

SPEED: Use the Task tool to dispatch subagents scanning different directories
in parallel. For example, dispatch one subagent per top-level directory, each
scanning all files within it. Collect their results and merge into a single output.

ISSUE CATEGORIES (use these exact type values):
  security    — SQL injection, XSS, hardcoded secrets, auth bypass, path traversal, insecure crypto
  bugs        — null/undefined derefs, off-by-one, race conditions, wrong logic, unhandled errors
  types       — type mismatches, unsafe casts, missing generics, any-typed values, wrong return types
  lint        — unused vars/imports, inconsistent naming, missing returns, unreachable code
  dead-code   — functions/classes/exports never called or imported anywhere
  stubs       — TODO, FIXME, HACK, placeholder implementations, empty catch blocks
  duplicates  — copy-pasted logic that should be extracted to a shared function
  coverage    — public functions with zero test coverage, untested error paths, missing edge cases

SEVERITY LEVELS:
  critical — exploitable in production (data loss, auth bypass, RCE, credential leak)
  high     — will cause bugs in normal usage or data corruption
  medium   — code smell, maintainability risk, potential future bugs
  low      — style issue, minor improvement, naming consistency
${planSection}${customSection}
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

SPEED: Use the Task tool to dispatch subagents scanning different directories
in parallel. Collect their results and merge into a single output.
${planSection}${customSection}
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

function clusterFixPrompt(cluster: IssueCluster, testCommand: string, customSection: string): string {
  const issueList = cluster.issues.map((issue, idx) =>
    `${idx + 1}. [${issue.severity}/${issue.type}] ${issue.file}${issue.line ? `:${issue.line}` : ''} — ${issue.description}`
  ).join('\n');

  // Encourage subagent parallelism when issues span multiple independent files
  const uniqueFiles = [...new Set(cluster.issues.map(i => i.file))];
  const parallelSection = uniqueFiles.length > 1
    ? `
PARALLELISM — IMPORTANT FOR SPEED:
These issues span ${uniqueFiles.length} independent files. Use the Task tool to dispatch
subagents that fix different files simultaneously. Group issues by file and send
each file's issues to a separate subagent. Each subagent should:
- Read the file, apply the fix, verify it compiles, then git add && git commit
- Work independently without coordinating with other subagents
This dramatically reduces total fix time.
`
    : '';

  return `You are fixing code quality issues in this repository. Fix these issues efficiently.
${parallelSection}
ISSUES TO FIX (in priority order):
${issueList}
${customSection}
FOR EACH ISSUE:
1. Read the file and understand the context
2. Make the MINIMAL change needed to fix the issue
3. Do not add comments explaining the fix
4. Do not reformat or restyle code you didn't change
${testCommand ? `5. Run tests after EACH fix: ${testCommand}` : '5. Verify your fix compiles/parses correctly'}
6. If tests pass: git add -A && git commit -m "fix(${cluster.issues[0]?.type || 'code'}): <short description>"
7. If tests fail: git checkout . && git clean -fd (revert and move on)
8. If an issue CANNOT be safely fixed: skip it and move to the next

After completing ALL issues, output ONLY this JSON:
{"results":[{"file":"path","line":42,"status":"fixed|skipped","reason":"only if skipped"}]}`;
}

function singleFixPrompt(issue: Issue, testCommand: string, customSection: string): string {
  return `Fix this specific code quality issue. Make the MINIMAL change required.

ISSUE:
  Type: ${issue.type}
  Severity: ${issue.severity}
  File: ${issue.file}${issue.line ? ` (line ${issue.line})` : ''}
  Problem: ${issue.description}
${customSection}
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

// ---------------------------------------------------------------------------
// Output parsing
// ---------------------------------------------------------------------------

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

function parseClusterResults(
  output: string,
  cluster: IssueCluster,
): { fixed: Issue[]; skipped: Issue[] } {
  const fixed: Issue[] = [];
  const skipped: Issue[] = [];

  try {
    let text = output;
    try {
      const parsed = JSON.parse(text);
      if (parsed.result) text = parsed.result;
      else if (typeof parsed === 'string') text = parsed;
    } catch {}

    const match = text.match(/\{[\s\S]*"results"[\s\S]*\}/);
    if (match) {
      const data = JSON.parse(match[0]);
      const results = data.results || [];

      for (const issue of cluster.issues) {
        const result = results.find((r: any) =>
          r.file === issue.file && (r.line === issue.line || !r.line)
        );
        if (result?.status === 'fixed') {
          issue.status = 'fixed';
          fixed.push(issue);
        } else if (result?.status === 'skipped') {
          issue.status = 'skipped';
          issue.skipReason = result.reason || 'Agent could not fix';
          skipped.push(issue);
        } else {
          issue.status = 'skipped';
          issue.skipReason = 'No result reported by agent';
          skipped.push(issue);
        }
      }
      return { fixed, skipped };
    }
  } catch {}

  // Fallback: if parsing failed, mark all as skipped
  for (const issue of cluster.issues) {
    issue.status = 'skipped';
    issue.skipReason = 'Could not parse agent output';
    skipped.push(issue);
  }
  return { fixed, skipped };
}

// ---------------------------------------------------------------------------
// Worktree management for parallel dispatch
// ---------------------------------------------------------------------------

async function createWorktree(baseBranch: string, workerName: string): Promise<string> {
  const tmpDir = path.join(os.tmpdir(), `sloppy-${workerName}-${Date.now()}`);
  await exec.exec('git', ['worktree', 'add', tmpDir, '-b', workerName, baseBranch], {
    ignoreReturnCode: true,
  });
  await exec.exec('git', ['config', 'user.name', 'sloppy[bot]'], { cwd: tmpDir, ignoreReturnCode: true });
  await exec.exec('git', ['config', 'user.email', 'sloppy[bot]@users.noreply.github.com'], { cwd: tmpDir, ignoreReturnCode: true });
  return tmpDir;
}

async function removeWorktree(worktreePath: string, branchName: string): Promise<void> {
  await exec.exec('git', ['worktree', 'remove', worktreePath, '--force'], { ignoreReturnCode: true });
  await exec.exec('git', ['branch', '-D', branchName], { ignoreReturnCode: true });
}

async function cherryPickCommits(fromBranch: string): Promise<string[]> {
  let logOutput = '';
  await exec.exec('git', ['log', `HEAD..${fromBranch}`, '--format=%H', '--reverse'], {
    listeners: { stdout: (d: Buffer) => { logOutput += d.toString(); } },
    ignoreReturnCode: true,
    silent: true,
  });

  const shas = logOutput.trim().split('\n').filter(s => s.length > 0);
  const picked: string[] = [];

  for (const sha of shas) {
    const exitCode = await exec.exec('git', ['cherry-pick', sha], { ignoreReturnCode: true });
    if (exitCode === 0) {
      picked.push(sha);
    } else {
      await exec.exec('git', ['cherry-pick', '--abort'], { ignoreReturnCode: true });
      core.warning(`Cherry-pick conflict on ${sha.slice(0, 7)} — skipping remaining commits from this worker`);
      break;
    }
  }

  return picked;
}

// ---------------------------------------------------------------------------
// Dispatch strategies
// ---------------------------------------------------------------------------

async function dispatchClusterSequential(
  cluster: IssueCluster,
  config: SloppyConfig,
  testCmd: string,
  customSection: string,
  deadline: number,
  margin: number,
): Promise<{ fixed: Issue[]; skipped: Issue[] }> {
  // For a single-issue cluster, use the focused single-issue prompt
  if (cluster.issues.length === 1) {
    const issue = cluster.issues[0];
    const result = await runAgent(config.agent, singleFixPrompt(issue, testCmd, customSection), {
      maxTurns: config.maxTurns.fix,
      model: config.model || undefined,
      timeout: Math.min(3 * 60 * 1000, deadline - Date.now() - margin),
      verbose: config.verbose,
    });

    if (result.output.includes('SKIP:')) {
      issue.status = 'skipped';
      issue.skipReason = result.output.match(/SKIP:\s*(.*)/)?.[1] || 'Agent could not fix';
      await gitRevert();
      return { fixed: [], skipped: [issue] };
    }

    // Agent may have timed out (exitCode !== 0) but still produced a valid fix.
    // Check for changes before giving up — only skip if nothing was modified.
    if (result.exitCode !== 0 && !(await gitHasChanges())) {
      issue.status = 'skipped';
      issue.skipReason = 'Agent exited with error and made no changes';
      return { fixed: [], skipped: [issue] };
    }

    if (await runTests(testCmd)) {
      const sha = await gitCommit(issue);
      issue.status = 'fixed';
      issue.commitSha = sha;
      return { fixed: [issue], skipped: [] };
    }

    issue.status = 'skipped';
    issue.skipReason = 'Tests failed after fix';
    await gitRevert();
    return { fixed: [], skipped: [issue] };
  }

  // Multi-issue cluster: give agent all issues at once with full autonomy
  const prompt = clusterFixPrompt(cluster, testCmd, customSection);
  const timeoutMs = Math.min(
    5 * 60 * 1000 * Math.ceil(cluster.issues.length / 3),
    deadline - Date.now() - margin,
  );

  const headBefore = await gitHead();

  const result = await runAgent(config.agent, prompt, {
    maxTurns: config.maxTurns.fix * 2,
    model: config.model || undefined,
    timeout: timeoutMs,
    verbose: config.verbose,
  });

  let parsed = parseClusterResults(result.output, cluster);

  // If structured output parsing failed, fall back to checking git history.
  // The agent commits each fix individually, so we can infer which issues
  // were fixed by checking which files were modified since headBefore.
  if (parsed.fixed.length === 0 && headBefore) {
    const gitParsed = await inferFixedFromGit(cluster, headBefore);
    if (gitParsed && gitParsed.fixed.length > 0) {
      core.info(`  Inferred ${gitParsed.fixed.length} fixed issue(s) from git history (agent output was not parseable)`);
      parsed = gitParsed;
    }
  }

  if (result.exitCode !== 0 && parsed.fixed.length === 0) {
    if (await gitHasChanges()) {
      await gitRevert();
    }
  }

  return parsed;
}

async function dispatchClustersParallel(
  clusters: IssueCluster[],
  config: SloppyConfig,
  testCmd: string,
  customSection: string,
  deadline: number,
  margin: number,
  baseBranch: string,
): Promise<{ fixed: Issue[]; skipped: Issue[] }> {
  const parallelism = Math.min(config.parallelAgents, clusters.length);
  const allFixed: Issue[] = [];
  const allSkipped: Issue[] = [];

  // Process in batches of `parallelism`
  for (let batchStart = 0; batchStart < clusters.length; batchStart += parallelism) {
    if (Date.now() >= deadline - margin) break;

    const batch = clusters.slice(batchStart, batchStart + parallelism);
    core.info(`  Dispatching batch of ${batch.length} parallel agents...`);

    // Create worktrees
    const workers: { cluster: IssueCluster; worktree: string; branch: string }[] = [];
    for (let i = 0; i < batch.length; i++) {
      const branchName = `sloppy-worker-${batchStart + i}-${Date.now()}`;
      const worktree = await createWorktree(baseBranch, branchName);
      workers.push({ cluster: batch[i], worktree, branch: branchName });
    }

    // Dispatch agents in parallel via Promise.all
    const promises = workers.map(async (worker) => {
      const timeoutMs = Math.min(
        5 * 60 * 1000 * Math.ceil(worker.cluster.issues.length / 3),
        deadline - Date.now() - margin,
      );

      const prompt = worker.cluster.issues.length === 1
        ? singleFixPrompt(worker.cluster.issues[0], testCmd, customSection)
        : clusterFixPrompt(worker.cluster, testCmd, customSection);

      core.info(`    [${worker.branch}] Fixing ${worker.cluster.issues.length} issues in ${worker.cluster.directory}/`);

      const headBefore = await gitHead(worker.worktree);

      const result = await runAgent(config.agent, prompt, {
        maxTurns: config.maxTurns.fix * 2,
        model: config.model || undefined,
        timeout: timeoutMs,
        verbose: config.verbose,
        cwd: worker.worktree,
      });

      return { worker, result, headBefore };
    });

    const results = await Promise.all(promises);

    // Cherry-pick commits from each worker back to main branch
    for (const { worker, result, headBefore } of results) {
      const { cluster } = worker;

      if (cluster.issues.length === 1) {
        const issue = cluster.issues[0];
        if (result.output.includes('SKIP:') || result.exitCode !== 0) {
          issue.status = 'skipped';
          issue.skipReason = result.output.match(/SKIP:\s*(.*)/)?.[1] || 'Agent could not fix';
          allSkipped.push(issue);
        } else {
          const picked = await cherryPickCommits(worker.branch);
          if (picked.length > 0) {
            issue.status = 'fixed';
            issue.commitSha = picked[0];
            allFixed.push(issue);
          } else {
            issue.status = 'skipped';
            issue.skipReason = 'No commits produced';
            allSkipped.push(issue);
          }
        }
      } else {
        let parsed = parseClusterResults(result.output, cluster);

        // If structured output parsing failed, infer from git history
        if (parsed.fixed.length === 0 && headBefore) {
          const gitParsed = await inferFixedFromGit(cluster, headBefore, worker.worktree);
          if (gitParsed && gitParsed.fixed.length > 0) {
            core.info(`    [${worker.branch}] Inferred ${gitParsed.fixed.length} fixed issue(s) from git history`);
            parsed = gitParsed;
          }
        }

        const picked = await cherryPickCommits(worker.branch);
        core.info(`    [${worker.branch}] Cherry-picked ${picked.length} commits`);

        for (let i = 0; i < Math.min(parsed.fixed.length, picked.length); i++) {
          parsed.fixed[i].commitSha = picked[i];
        }

        allFixed.push(...parsed.fixed);
        allSkipped.push(...parsed.skipped);
      }

      // Cleanup worktree
      await removeWorktree(worker.worktree, worker.branch);
    }
  }

  return { fixed: allFixed, skipped: allSkipped };
}

// ---------------------------------------------------------------------------
// The main fix loop
// ---------------------------------------------------------------------------

export async function runFixLoop(config: SloppyConfig, pluginCtx?: PluginContext): Promise<LoopState> {
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
  const margin = 2 * 60 * 1000;
  const useParallel = config.parallelAgents > 1;

  // Header
  ui.section('FIX MODE');
  ui.kv('Agent', config.agent);
  ui.kv('Model', config.model || 'default');
  ui.kv('Timeout', formatDuration(config.timeout));
  ui.kv('Max passes', String(config.maxPasses));
  ui.kv('Max issues', `${config.maxIssuesPerPass || 'unlimited'}/pass`);
  ui.kv('Parallel', `${config.parallelAgents} agent${config.parallelAgents > 1 ? 's' : ''}${useParallel ? ' (worktree mode)' : ''}`);
  ui.kv('Verbose', config.verbose ? ui.c('ON', ui.S.green) + ui.c(' (streaming)', ui.S.gray) : 'off');
  ui.kv('Chain', `${state.chainNumber}/${config.maxChains}`);

  // Parallelize setup: install agent, git config, test detection, LOC counting
  // all happen concurrently since they're independent.
  ui.section('SETUP');
  const cwd = process.env.GITHUB_WORKSPACE || process.cwd();

  const [, , testCmd, sourceFiles] = await Promise.all([
    // 1. Install agent
    (async () => {
      core.info(`  Installing ${config.agent}...`);
      await installAgent(config.agent);
      core.info(`  ${ui.c(ui.SYM.check, ui.S.green)} Agent installed`);
    })(),
    // 2. Git config + branch setup
    (async () => {
      await exec.exec('git', ['config', 'user.name', 'sloppy[bot]']);
      await exec.exec('git', ['config', 'user.email', 'sloppy[bot]@users.noreply.github.com']);
      if (!state.branchName) {
        state.branchName = `sloppy/fix-${new Date().toISOString().slice(0, 10)}-${state.runId.slice(-6)}`;
        await exec.exec('git', ['checkout', '-b', state.branchName], { ignoreReturnCode: true });
        ui.kv('Branch', `${state.branchName} ${ui.c('(new)', ui.S.green)}`);
      } else {
        await exec.exec('git', ['checkout', state.branchName], { ignoreReturnCode: true });
        ui.kv('Branch', `${state.branchName} ${ui.c('(resumed)', ui.S.yellow)}`);
      }
    })(),
    // 3. Detect test command
    detectTestCommand(config),
    // 4. Collect source files (for LOC counting)
    Promise.resolve(collectFiles(cwd)),
  ]);

  ui.kv('Tests', testCmd ? testCmd : ui.c('none detected', ui.S.yellow));

  const loc = countSourceLOC(sourceFiles);
  ui.kv('Source LOC', loc.toLocaleString());

  // Load PLAN.md if it exists
  let plan = '';
  const planPath = path.join(cwd, 'PLAN.md');
  if (fs.existsSync(planPath)) {
    plan = fs.readFileSync(planPath, 'utf-8').slice(0, 4000);
    ui.kv('Plan', 'PLAN.md loaded');
  }

  const customSection = pluginCtx ? formatCustomPromptSection(pluginCtx, config) : '';

  // Load preexisting issues from output file
  let seededIssues: Issue[] = [];
  if (!checkpoint && config.outputFile) {
    const prior = loadOutputFile(config.outputFile);
    seededIssues = prior.filter(i => i.status === 'found');
    if (seededIssues.length > 0) {
      ui.kv('Preexisting', `${seededIssues.length} issues from ${config.outputFile}`);
    }
  }

  // --- THE RELENTLESS LOOP ---
  while (Date.now() < deadline - margin && state.pass < config.maxPasses) {
    state.pass++;
    const passStart = Date.now();

    ui.section(`PASS ${state.pass}/${config.maxPasses}  ${ui.c(ui.SYM.diamond, ui.S.gray)} ${ui.c(formatTimeRemaining(deadline) + ' left', ui.S.gray)}  ${ui.c(ui.SYM.diamond, ui.S.gray)} ${ui.c(state.totalFixed + ' fixed', ui.S.green)}`);

    const prevFixes = state.issues
      .filter(i => i.status === 'fixed')
      .slice(-20)
      .map(i => `[${i.type}] ${i.file}: ${i.description}`);

    // PHASE 1: SCAN
    let found: Issue[];
    if (seededIssues.length > 0 && state.pass === 1) {
      found = seededIssues;
      seededIssues = [];
      core.info(`  Using ${ui.c(String(found.length), ui.S.bold)} preexisting issues ${ui.c('(skipping rescan)', ui.S.gray)}`);
    } else {
      if (pluginCtx) await runHook(pluginCtx.plugins, 'pre-scan');

      core.info(`  Scanning repository...`);
      const scanStart = Date.now();
      const scanResult = await runAgent(config.agent, scanPrompt(state.pass, prevFixes, plan, customSection), {
        maxTurns: config.maxTurns.scan,
        model: config.model || undefined,
        timeout: Math.min(5 * 60 * 1000, deadline - Date.now() - margin),
        verbose: config.verbose,
      });
      const scanDuration = formatDuration(Date.now() - scanStart);

      // Detect scan failure — don't treat empty output + error exit as "clean"
      if (scanResult.exitCode !== 0 && !scanResult.output.trim()) {
        core.warning(`Scan agent failed (exit ${scanResult.exitCode}, no output) — will retry next pass`);
        state.passes.push({ number: state.pass, found: 0, fixed: 0, skipped: 0, durationMs: Date.now() - passStart });
        continue;
      }

      found = parseIssues(scanResult.output);

      if (pluginCtx) await runHook(pluginCtx.plugins, 'post-scan');

      if (pluginCtx) {
        const before = found.length;
        found = applyFilters(found, pluginCtx.filters);
        if (found.length < before) {
          core.info(`Plugin filters removed ${before - found.length} issues`);
        }
      }

      // Apply min-severity filter
      if (config.minSeverity !== 'low') {
        const SRANK: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };
        const minRank = SRANK[config.minSeverity] ?? 0;
        const before = found.length;
        found = found.filter(i => (SRANK[i.severity] ?? 0) >= minRank);
        if (found.length < before) {
          core.info(`  min-severity filter (${config.minSeverity}+) removed ${before - found.length} issues`);
        }
      }

      // Apply allow-list (false positive suppressions)
      if (config.allow.length > 0) {
        const before = found.length;
        found = applyAllowRules(found, config.allow);
        if (found.length < before) {
          core.info(`  Allow-list suppressed ${before - found.length} issues`);
        }
      }

      core.info(`  ${ui.c(ui.SYM.check, ui.S.green)} Scan complete ${ui.c(`(${scanDuration})`, ui.S.gray)}: found ${ui.c(String(found.length), ui.S.bold)} issues`);
    }

    if (found.length > 0) {
      const bySev: Record<string, number> = {};
      for (const issue of found) bySev[issue.severity] = (bySev[issue.severity] || 0) + 1;
      ui.severityBreakdown(bySev);
    }

    // Check if done
    if (found.length === 0 && state.pass >= config.minPasses) {
      ui.blank();
      core.info(`  ${ui.c(ui.SYM.check, ui.S.bold, ui.S.green)} ${ui.c('Repository is CLEAN', ui.S.bold, ui.S.green)} ${ui.c('— verified across multiple passes', ui.S.gray)}`);
      state.complete = true;
      state.passes.push({ number: state.pass, found: 0, fixed: 0, skipped: 0, durationMs: Date.now() - passStart });
      break;
    }

    if (found.length === 0) {
      core.info(`  ${ui.c(ui.SYM.check, ui.S.green)} No issues found ${ui.c(`(${config.minPasses - state.pass + 1} more clean pass(es) needed)`, ui.S.gray)}`);
      state.passes.push({ number: state.pass, found: 0, fixed: 0, skipped: 0, durationMs: Date.now() - passStart });
      continue;
    }

    // PHASE 2: CLUSTER issues by directory
    const sorted = sortBySeverity(found);
    const limit = config.maxIssuesPerPass > 0 ? config.maxIssuesPerPass : sorted.length;
    const toFix = sorted.slice(0, limit);

    const clusters = clusterIssues(toFix);
    ui.blank();
    core.info(`  Clustered ${ui.c(String(toFix.length), ui.S.bold)} issues into ${ui.c(String(clusters.length), ui.S.bold)} groups`);
    for (let ci = 0; ci < clusters.length; ci++) {
      const cl = clusters[ci];
      const prefix = ci === clusters.length - 1 ? ui.SYM.cornerRight : ui.SYM.teeRight;
      core.info(`  ${ui.c(prefix + ui.SYM.dash, ui.S.gray)} ${cl.directory}/ ${ui.c(`(${cl.issues.length} issues, ${cl.files.length} files)`, ui.S.gray)}`);
    }

    // PHASE 3: DISPATCH — parallel or sequential
    let passFixed = 0;
    let passSkipped = 0;

    if (pluginCtx) await runHook(pluginCtx.plugins, 'pre-fix', {});

    if (useParallel && clusters.length > 1) {
      ui.blank();
      core.info(`  Dispatching ${ui.c(String(clusters.length), ui.S.bold)} clusters across ${ui.c(String(config.parallelAgents), ui.S.bold)} parallel agents`);
      const { fixed, skipped } = await dispatchClustersParallel(
        clusters, config, testCmd, customSection, deadline, margin, state.branchName,
      );

      passFixed = fixed.length;
      passSkipped = skipped.length;
      state.issues.push(...fixed, ...skipped);

      for (const issue of fixed) {
        state.totalFixed++;
        ui.fixed(issue.file, issue.description, issue.commitSha);
      }
      for (const issue of skipped) {
        state.totalSkipped++;
        ui.skipped(issue.file, issue.description, issue.skipReason);
      }
    } else {
      // Sequential cluster-based dispatch
      for (let ci = 0; ci < clusters.length; ci++) {
        const cluster = clusters[ci];
        if (Date.now() >= deadline - margin) {
          core.warning('Timeout approaching — stopping');
          break;
        }

        ui.blank();
        ui.clusterHeader(ci + 1, clusters.length, cluster.directory, cluster.issues.length);
        for (const issue of cluster.issues) {
          ui.issueFound(issue.file, issue.line, issue.description, issue.severity, issue.type);
        }

        const clusterStart = Date.now();
        const { fixed, skipped } = await dispatchClusterSequential(
          cluster, config, testCmd, customSection, deadline, margin,
        );
        const clusterDur = formatDuration(Date.now() - clusterStart);

        passFixed += fixed.length;
        passSkipped += skipped.length;

        for (const issue of fixed) {
          state.totalFixed++;
          ui.fixed(issue.file, issue.description, issue.commitSha);
        }
        for (const issue of skipped) {
          state.totalSkipped++;
          ui.skipped(issue.file, issue.description, issue.skipReason, clusterDur);
        }

        if (pluginCtx) {
          for (const issue of [...fixed, ...skipped]) {
            await runHook(pluginCtx.plugins, 'post-fix', {
              SLOPPY_ISSUE_FILE: issue.file,
              SLOPPY_ISSUE_TYPE: issue.type,
              SLOPPY_ISSUE_STATUS: issue.status,
            });
          }
        }

        state.issues.push(...fixed, ...skipped);
      }
    }

    // PHASE 4: VERIFY — full test suite after all clusters in this pass
    if (testCmd && passFixed > 0) {
      ui.blank();
      core.info(`  Running full test suite...`);
      if (await runTests(testCmd)) {
        core.info(`  ${ui.c(ui.SYM.check, ui.S.bold, ui.S.green)} ${ui.c('All tests pass', ui.S.green)}`);
      } else {
        core.info(`  ${ui.c(ui.SYM.cross, ui.S.bold, ui.S.red)} ${ui.c('Test suite failed', ui.S.red)} ${ui.c('— some commits may conflict', ui.S.gray)}`);
      }
    }

    state.passes.push({
      number: state.pass,
      found: found.length,
      fixed: passFixed,
      skipped: passSkipped,
      durationMs: Date.now() - passStart,
    });

    ui.blank();
    ui.passSummary(state.pass, passFixed, passSkipped, formatDuration(Date.now() - passStart));
    core.info(`  ${ui.c('Running totals:', ui.S.gray)} ${ui.c(String(state.totalFixed), ui.S.bold, ui.S.green)} fixed, ${ui.c(String(state.totalSkipped), ui.S.yellow)} skipped`);

    saveCheckpoint(state);

    // Push after each pass so fixes aren't lost if the job is killed.
    // GH Actions sends SIGTERM → SIGKILL on timeout, so we can't rely
    // on reaching the final push at the end.
    if (passFixed > 0 && state.branchName) {
      core.info(`  Pushing ${ui.c(String(state.totalFixed), ui.S.bold)} fixes to ${ui.c(state.branchName, ui.S.cyan)}...`);
      if (await gitPushBranch(state.branchName)) {
        core.info(`  ${ui.c(ui.SYM.check, ui.S.green)} Push OK`);
      } else {
        core.warning('Push failed — will retry at end');
      }
    }

    if (config.outputFile) {
      const remaining = state.issues.filter(i => i.status !== 'fixed');
      const currentScore = calculateScore(remaining, loc);
      writeOutputFile(config.outputFile, state.issues, 'fix', currentScore, state.scoreBefore || calculateScore(state.issues, loc));
    }
  }

  // Calculate scores
  const allFound = state.issues;
  const remaining = allFound.filter(i => i.status !== 'fixed');
  state.scoreAfter = calculateScore(remaining, loc);
  if (state.scoreBefore === 0) state.scoreBefore = calculateScore(allFound, loc);

  // Final push (safety net — each pass already pushes, but do one more in case)
  if (state.totalFixed > 0 && state.branchName) {
    ui.section('PUSH');
    core.info(`  Final push of ${ui.c(String(state.totalFixed), ui.S.bold)} fixes on ${ui.c(state.branchName, ui.S.cyan)}...`);
    if (await gitPushBranch(state.branchName)) {
      core.info(`  ${ui.c(ui.SYM.check, ui.S.bold, ui.S.green)} Push complete`);
    } else {
      core.warning('Final push failed — fixes may have been pushed after an earlier pass');
    }
  }

  // Final summary
  ui.blank();
  ui.banner('FIX COMPLETE');
  ui.scoreChange(state.scoreBefore, state.scoreAfter);
  ui.stat('Fixed', String(state.totalFixed));
  ui.stat('Skipped', String(state.totalSkipped));
  ui.stat('Passes', String(state.passes.length));
  ui.stat('Duration', formatDuration(Date.now() - startTime));
  ui.stat('Complete', state.complete
    ? ui.c('YES', ui.S.bold, ui.S.green)
    : ui.c('NO', ui.S.yellow) + ui.c(' (more work may remain)', ui.S.gray));
  core.info(ui.divider());

  saveCheckpoint(state);
  return state;
}
