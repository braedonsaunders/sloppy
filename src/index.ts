import * as core from '@actions/core';
import { getConfig, getRawActionInputs } from './config';
import { runScan } from './scan';
import { runFixLoop } from './loop';
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
import { HistoryEntry, ScanResult, LoopState, PluginContext } from './types';
import { resolveCustomPrompt, loadPlugins, buildPluginContext } from './plugins';
import { loadRepoConfig, mergeRepoConfig, loadProfile, applyProfile } from './sloppy-config';
import * as ui from './ui';

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
    const profileName = config.profile || repoConfig?.mode; // profile comes from action input
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
      // ---- FREE TIER: GitHub Models ----
      const result = await runScan(config, pluginCtx);

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
        agent: 'github-models',
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
