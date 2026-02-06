import * as core from '@actions/core';
import { getConfig } from './config';
import { runScan } from './scan';
import { runFixLoop } from './loop';
import { triggerChain } from './chain';
import {
  writeJobSummary,
  createPullRequest,
  postScanComment,
  updateBadge,
  appendHistory,
} from './report';
import { deployDashboard } from './dashboard';
import { HistoryEntry, ScanResult, LoopState } from './types';

async function run(): Promise<void> {
  try {
    const config = getConfig();

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

    core.info(`Sloppy v1 — mode: ${config.mode}, agent: ${config.agent}`);
    core.info(`Auth: GITHUB_TOKEN=${hasGithubToken ? 'yes' : 'NO'}, ANTHROPIC_API_KEY=${hasAnthropicKey ? 'yes' : 'no'}, CLAUDE_OAUTH=${hasClaudeOAuth ? 'yes' : 'no'}, OPENAI_API_KEY=${hasOpenAIKey ? 'yes' : 'no'}`);

    if (config.mode === 'scan') {
      // ---- FREE TIER: GitHub Models ----
      const result = await runScan(config);

      core.setOutput('score', result.score);
      core.setOutput('issues-found', result.issues.length);

      await postScanComment(result);
      await writeJobSummary(result);
      await updateBadge(result.score);

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

      core.info(`Done. Score: ${result.score}/100, Issues: ${result.issues.length}`);

    } else {
      // ---- FIX MODE: Claude Code or Codex CLI ----
      const state = await runFixLoop(config);

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

      core.info(`Done. Score: ${state.scoreBefore} → ${state.scoreAfter}, Fixed: ${state.totalFixed}`);
    }
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
}

run();
