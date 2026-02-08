import * as core from '@actions/core';
import { getConfig, getRawActionInputs } from './config';
import { runScan, collectFiles, countSourceLOC, calculateScore } from './scan';
import { runFixLoop } from './loop';
import { installAgent, runAgent } from './agent';
import { Issue, IssueType, Severity, ScanResult } from './types';
import { mapRawToIssue } from './utils';
import { triggerChain } from './chain';
import {
  writeJobSummary,
  createPullRequest,
  postScanComment,
  updateBadge,
  appendHistory,
  writeOutputFile,
  loadOutputFile,
} from './report';
import { deployDashboard } from './dashboard';
import { resolveCustomPrompt, loadPlugins, buildPluginContext } from './plugins';
import { loadRepoConfig, mergeRepoConfig, loadProfile, applyProfile } from './sloppy-config';
import * as ui from './ui';

/**
 * Run scan using the fix-mode agent (Claude/Codex) instead of GitHub Models.
 * This gives higher quality scans using the same model as fix mode.
 */
async function runAgentScan(config: import('./types').SloppyConfig, customPrompt: string): Promise<ScanResult> {
  const cwd = process.env.GITHUB_WORKSPACE || process.cwd();

  ui.section('SCAN (Agent)');
  ui.kv('Provider', `${config.agent}${config.model ? ` (${config.model})` : ''}`);

  await installAgent(config.agent);

  const files = collectFiles(cwd);
  const loc = countSourceLOC(files);
  ui.kv('Files', `${files.length} files, ${loc.toLocaleString()} LOC`);

  const customSection = customPrompt ? `\nCUSTOM RULES:\n${customPrompt}\n` : '';

  const prompt = `You are a senior code quality auditor performing a comprehensive codebase review.

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
${customSection}
RULES:
- Check EVERY file. Do not skip any directory.
- Only report REAL issues with specific file paths and line numbers.
- Do not invent issues. If code is clean, return empty issues array.
- Be precise: exact file, exact line, exact description of what's wrong.
- Prioritize: security > bugs > types > everything else.

Respond with ONLY valid JSON. No markdown. No code fences. No explanation.
{"issues":[{"type":"security|bugs|types|lint|dead-code|stubs|duplicates|coverage","severity":"critical|high|medium|low","file":"relative/path/to/file.ts","line":42,"description":"what is wrong and why it matters"}]}`;

  core.info(`  Running ${config.agent} agent scan...`);
  const scanStart = Date.now();

  const { output, exitCode } = await runAgent(config.agent, prompt, {
    maxTurns: config.maxTurns.scan,
    model: config.model || undefined,
    timeout: config.timeout,
    verbose: config.verbose,
  });

  const elapsed = Date.now() - scanStart;
  core.info(`  Agent scan completed in ${Math.round(elapsed / 1000)}s (exit code ${exitCode})`);

  // Parse issues from agent output
  const issues: Issue[] = [];
  try {
    const jsonMatch = output.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[0]);
      const rawIssues: unknown[] = data.issues || [];
      for (let i = 0; i < rawIssues.length; i++) {
        const issue = mapRawToIssue(rawIssues[i], 'scan', i);
        if (issue) {
          issue.source = 'ai';
          issues.push(issue);
        }
      }
    }
  } catch (e) {
    core.warning(`Failed to parse agent scan output: ${e}`);
  }

  const score = calculateScore(issues, loc);
  const summary = `Found ${issues.length} issues across ${files.length} files. Score: ${score}/100.`;

  ui.blank();
  ui.banner('SCAN COMPLETE');
  ui.score(score, 'Score');
  ui.stat('LOC', loc.toLocaleString());
  ui.stat('Issues', `${issues.length} found`);
  ui.stat('Duration', `${Math.round(elapsed / 1000)}s`);
  core.info(ui.divider());

  return { issues, score, summary, tokens: 0 };
}

async function run(): Promise<void> {
  try {
    const config = getConfig();
    const rawInputs = getRawActionInputs();

    // Bridge github-token input to GITHUB_TOKEN env var if not already set
    if (!process.env.GITHUB_TOKEN) {
      const inputToken = core.getInput('github-token');
      if (inputToken) {
        process.env.GITHUB_TOKEN = inputToken;
        core.setSecret(inputToken);
      }
    }

    // Log auth context for debugging
    const hasGithubToken = !!(process.env.GITHUB_TOKEN || core.getInput('github-token'));
    const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;
    const hasClaudeOAuth = !!process.env.CLAUDE_CODE_OAUTH_TOKEN;
    const hasOpenAIKey = !!process.env.OPENAI_API_KEY;

    // Load .sloppy.yml repo config and optional profile overlay
    const cwd = process.env.GITHUB_WORKSPACE || process.cwd();
    let repoConfig = loadRepoConfig(cwd);

    // Apply profile if specified (action input or repo config)
    if (config.profile) {
      const profileOverlay = loadProfile(cwd, config.profile);
      if (profileOverlay && repoConfig) {
        repoConfig = applyProfile(repoConfig, profileOverlay);
      } else if (profileOverlay) {
        repoConfig = profileOverlay;
      }
    }

    // Merge repo config into runtime config
    if (repoConfig) {
      mergeRepoConfig(config, repoConfig, rawInputs);
    }

    ui.blank();
    ui.banner(
      'S L O P P Y',
      `Code Quality Scanner & Auto-Fixer  v1`,
    );
    ui.blank();
    ui.kv('Mode', config.mode);
    ui.kv('Agent', config.agent);
    ui.kv('Auth', [
      hasGithubToken ? ui.c('GITHUB', ui.S.green) : ui.c('GITHUB', ui.S.red),
      hasAnthropicKey ? ui.c('ANTHROPIC', ui.S.green) : '',
      hasClaudeOAuth ? ui.c('OAUTH', ui.S.green) : '',
      hasOpenAIKey ? ui.c('OPENAI', ui.S.green) : '',
    ].filter(Boolean).join(ui.c(' / ', ui.S.gray)));

    if (config.minSeverity !== 'low') {
      ui.kv('Min severity', config.minSeverity);
    }
    if (config.app && Object.keys(config.app).length > 0) {
      const appParts: string[] = [];
      if (config.app.type) appParts.push(config.app.type);
      if (config.app.exposure) appParts.push(config.app.exposure);
      if (config.app.dataSensitivity) appParts.push(`${config.app.dataSensitivity}-sensitivity`);
      ui.kv('App context', appParts.join(' / '));
    }
    if (config.framework) ui.kv('Framework', config.framework);
    if (config.allow.length > 0) ui.kv('Allow rules', `${config.allow.length} suppression(s)`);
    if (config.profile) ui.kv('Profile', config.profile);

    // Load custom prompts, plugins
    const customPrompt = resolveCustomPrompt(config.customPrompt, config.customPromptFile, cwd);
    const plugins = config.pluginsEnabled ? loadPlugins(cwd) : [];
    const pluginCtx = buildPluginContext(plugins, customPrompt);

    // Merge ignore patterns from repo config into plugin filters
    if (repoConfig) {
      if (repoConfig.ignore && repoConfig.ignore.length > 0) {
        const existing = pluginCtx.filters['exclude-paths'] || [];
        pluginCtx.filters['exclude-paths'] = [...new Set([...existing, ...repoConfig.ignore])];
      }

      // Merge rules: 'off' → exclude-types, severity values are noted for future use
      if (repoConfig.rules) {
        const excludeTypes = new Set(pluginCtx.filters['exclude-types'] || []);
        for (const [type, val] of Object.entries(repoConfig.rules)) {
          if (val === 'off') excludeTypes.add(type);
        }
        if (excludeTypes.size > 0) {
          pluginCtx.filters['exclude-types'] = [...excludeTypes];
        }
      }

      // Merge min-severity into plugin filters as well
      if (repoConfig.minSeverity && config.minSeverity !== 'low') {
        pluginCtx.filters['min-severity'] = config.minSeverity;
      }
    }

    if (customPrompt) {
      core.info(`Custom prompt: ${customPrompt.length} chars loaded`);
    }
    if (plugins.length > 0) {
      core.info(`Plugins: ${plugins.map(p => p.name).join(', ')}`);
    }

    if (config.mode === 'scan') {
      let result: ScanResult;

      if (config.scanProvider === 'agent') {
        // ---- AGENT SCAN: same provider/model as fix mode ----
        result = await runAgentScan(config, pluginCtx.customPrompt);
      } else {
        // ---- FREE TIER: GitHub Models ----
        result = await runScan(config, pluginCtx);
      }

      core.setOutput('score', result.score);
      core.setOutput('issues-found', result.issues.length);

      await postScanComment(result);
      await writeJobSummary(result);
      await updateBadge(result.score);

      if (config.outputFile) {
        const resolved = writeOutputFile(config.outputFile, result.issues, 'scan', result.score);
        core.setOutput('output-file', resolved);
      }

      // Point users to the Job Summary (native GitHub UI)
      const runUrl = `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`;
      core.notice(`Sloppy scan complete — score: ${result.score}/100. View full results in the Job Summary tab.`);
      core.setOutput('summary-url', runUrl);

      const byType: Record<string, number> = {};
      for (const i of result.issues) byType[i.type] = (byType[i.type] || 0) + 1;

      const history = appendHistory({
        run: parseInt(process.env.GITHUB_RUN_NUMBER || '1'),
        date: new Date().toISOString().slice(0, 10),
        score: result.score,
        scoreBefore: result.score,
        fixed: 0,
        skipped: 0,
        passes: 1,
        durationMs: 0,
        byType,
        mode: 'scan',
        agent: config.scanProvider === 'agent' ? config.agent : 'github-models',
      });

      deployDashboard(history);

      // Fail if below threshold
      if (config.failBelow > 0 && result.score < config.failBelow) {
        core.setFailed(`Score ${result.score} is below threshold ${config.failBelow}`);
        return;
      }

      ui.blank();
      ui.finalResults();
      ui.score(result.score);
      ui.stat('Issues', `${result.issues.length} found`);
      ui.blank();

    } else {
      // ---- FIX MODE: Claude Code or Codex CLI ----
      const state = await runFixLoop(config, pluginCtx);

      core.setOutput('score', state.scoreAfter);
      core.setOutput('score-before', state.scoreBefore);
      core.setOutput('issues-found', state.issues.length);
      core.setOutput('issues-fixed', state.totalFixed);

      // Chain if not complete and under chain limit
      if (!state.complete && state.chainNumber < config.maxChains && state.issues.some(i => i.status === 'found')) {
        core.info('Work remaining. Triggering continuation...');
        await triggerChain(state);
      }

      // Create PR
      const prUrl = await createPullRequest(state);
      if (prUrl) core.setOutput('pr-url', prUrl);

      await writeJobSummary(state);
      await updateBadge(state.scoreAfter);

      if (config.outputFile) {
        const resolved = writeOutputFile(config.outputFile, state.issues, 'fix', state.scoreAfter, state.scoreBefore);
        core.setOutput('output-file', resolved);
      }

      // Point users to the Job Summary (native GitHub UI)
      const runUrl = `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`;
      core.notice(`Sloppy fix complete — score: ${state.scoreBefore} → ${state.scoreAfter}. View full results in the Job Summary tab.`);
      core.setOutput('summary-url', runUrl);

      const byType: Record<string, number> = {};
      for (const i of state.issues.filter(i => i.status === 'fixed')) {
        byType[i.type] = (byType[i.type] || 0) + 1;
      }

      const totalDur = state.passes.reduce((s, p) => s + p.durationMs, 0);
      const history = appendHistory({
        run: parseInt(process.env.GITHUB_RUN_NUMBER || '1'),
        date: new Date().toISOString().slice(0, 10),
        score: state.scoreAfter,
        scoreBefore: state.scoreBefore,
        fixed: state.totalFixed,
        skipped: state.totalSkipped,
        passes: state.passes.length,
        durationMs: totalDur,
        byType,
        prUrl: prUrl || undefined,
        mode: 'fix',
        agent: config.agent,
      });

      deployDashboard(history);

      // Fail if below threshold
      if (config.failBelow > 0 && state.scoreAfter < config.failBelow) {
        core.setFailed(`Score ${state.scoreAfter} is below threshold ${config.failBelow}`);
        return;
      }

      ui.blank();
      ui.finalResults();
      ui.scoreChange(state.scoreBefore, state.scoreAfter);
      ui.stat('Fixed', `${state.totalFixed} issues`);
      ui.stat('Skipped', `${state.totalSkipped} issues`);
      ui.stat('Passes', String(state.passes.length));
      ui.blank();
    }
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
}

run();
