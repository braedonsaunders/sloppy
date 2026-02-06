import * as core from '@actions/core';
import { SloppyConfig, IssueType, ScanScope, Severity } from './types';
import { parseTimeout, VALID_SEVERITIES } from './utils';

/**
 * Collect raw action input strings so mergeRepoConfig can detect which
 * inputs were explicitly set vs left at default.
 */
export function getRawActionInputs(): Record<string, string> {
  return {
    'mode': core.getInput('mode'),
    'agent': core.getInput('agent'),
    'timeout': core.getInput('timeout'),
    'max-cost': core.getInput('max-cost'),
    'max-passes': core.getInput('max-passes'),
    'min-passes': core.getInput('min-passes'),
    'max-chains': core.getInput('max-chains'),
    'strictness': core.getInput('strictness'),
    'fix-types': core.getInput('fix-types'),
    'model': core.getInput('model'),
    'github-models-model': core.getInput('github-models-model'),
    'test-command': core.getInput('test-command'),
    'fail-below': core.getInput('fail-below'),
    'verbose': core.getInput('verbose'),
    'max-turns': core.getInput('max-turns'),
    'max-issues-per-pass': core.getInput('max-issues-per-pass'),
    'scan-scope': core.getInput('scan-scope'),
    'output-file': core.getInput('output-file'),
    'custom-prompt': core.getInput('custom-prompt'),
    'custom-prompt-file': core.getInput('custom-prompt-file'),
    'plugins': core.getInput('plugins'),
    'parallel-agents': core.getInput('parallel-agents'),
    'min-severity': core.getInput('min-severity'),
    'profile': core.getInput('profile'),
  };
}

export function getConfig(): SloppyConfig {
  const hasApiKey = !!(
    process.env.ANTHROPIC_API_KEY ||
    process.env.CLAUDE_CODE_OAUTH_TOKEN ||
    process.env.OPENAI_API_KEY
  );
  const modeInput = core.getInput('mode') || (hasApiKey ? 'fix' : 'scan');

  const minSevInput = (core.getInput('min-severity') || 'low').toLowerCase();
  const minSeverity: Severity = VALID_SEVERITIES.has(minSevInput)
    ? minSevInput as Severity
    : 'low';

  return {
    mode: modeInput as 'scan' | 'fix',
    agent: (core.getInput('agent') || 'claude') as 'claude' | 'codex',
    timeout: parseTimeout(core.getInput('timeout') || '30m'),
    maxCost: parseFloat((core.getInput('max-cost') || '$5.00').replace('$', '')) || 5,
    maxPasses: parseInt(core.getInput('max-passes') || '10') || 10,
    minPasses: parseInt(core.getInput('min-passes') || '2') || 2,
    maxChains: parseInt(core.getInput('max-chains') || '3') || 3,
    fixTypes: (core.getInput('fix-types') || 'security,bugs,types,lint,dead-code,stubs,duplicates,coverage')
      .split(',').map(s => s.trim()) as IssueType[],
    strictness: (core.getInput('strictness') || 'high') as 'low' | 'medium' | 'high',
    minSeverity,
    model: core.getInput('model') || '',
    githubModelsModel: core.getInput('github-models-model') || 'openai/gpt-4o-mini',
    testCommand: core.getInput('test-command') || '',
    failBelow: parseInt(core.getInput('fail-below') || '0') || 0,
    verbose: core.getInput('verbose') === 'true',
    maxTurns: {
      scan: parseInt(core.getInput('max-turns') || '0') || 30,
      fix: parseInt(core.getInput('max-turns') || '0') || 15,
    },
    maxIssuesPerPass: parseInt(core.getInput('max-issues-per-pass') || '0') || 0,
    scanScope: (core.getInput('scan-scope') || 'auto') as ScanScope,
    outputFile: core.getInput('output-file') || '',
    customPrompt: core.getInput('custom-prompt') || '',
    customPromptFile: core.getInput('custom-prompt-file') || '',
    pluginsEnabled: (core.getInput('plugins') || 'true') !== 'false',
    parallelAgents: Math.min(Math.max(parseInt(core.getInput('parallel-agents') || '3') || 3, 1), 8),
    app: {},
    framework: '',
    runtime: '',
    trustInternal: [],
    trustUntrusted: [],
    allow: [],
    profile: core.getInput('profile') || '',
  };
}
