import * as core from '@actions/core';
import { SloppyConfig, IssueType } from './types';

function parseTimeout(input: string): number {
  const match = input.match(/^(\d+)(s|m|h)?$/);
  if (!match) return 30 * 60 * 1000;
  const value = parseInt(match[1]);
  const unit = match[2] || 'm';
  switch (unit) {
    case 's': return value * 1000;
    case 'h': return value * 60 * 60 * 1000;
    default:  return value * 60 * 1000;
  }
}

export function getConfig(): SloppyConfig {
  const hasApiKey = !!(
    process.env.ANTHROPIC_API_KEY ||
    process.env.CLAUDE_CODE_OAUTH_TOKEN ||
    process.env.OPENAI_API_KEY
  );
  const modeInput = core.getInput('mode') || (hasApiKey ? 'fix' : 'scan');

  return {
    mode: modeInput as 'scan' | 'fix',
    agent: (core.getInput('agent') || 'claude') as 'claude' | 'codex',
    timeout: parseTimeout(core.getInput('timeout') || '30m'),
    maxCost: parseFloat((core.getInput('max-cost') || '$5.00').replace('$', '')) || 5,
    maxPasses: parseInt(core.getInput('max-passes') || '10'),
    minPasses: parseInt(core.getInput('min-passes') || '2'),
    maxChains: parseInt(core.getInput('max-chains') || '3'),
    fixTypes: (core.getInput('fix-types') || 'security,bugs,types,lint,dead-code,stubs,duplicates,coverage')
      .split(',').map(s => s.trim()) as IssueType[],
    strictness: (core.getInput('strictness') || 'high') as 'low' | 'medium' | 'high',
    model: core.getInput('model') || '',
    githubModelsModel: core.getInput('github-models-model') || 'openai/gpt-4o',
    testCommand: core.getInput('test-command') || '',
    failBelow: parseInt(core.getInput('fail-below') || '0'),
    verbose: core.getInput('verbose') === 'true',
    maxTurns: {
      scan: parseInt(core.getInput('max-turns') || '0') || 30,
      fix: parseInt(core.getInput('max-turns') || '0') || 15,
    },
    maxIssuesPerPass: parseInt(core.getInput('max-issues-per-pass') || '0'),
  };
}
