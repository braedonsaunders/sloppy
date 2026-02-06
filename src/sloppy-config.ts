/**
 * .sloppy.yml repo config loader.
 *
 * This is the single source of truth for all non-secret Sloppy settings.
 * Everything that can be configured in the GitHub Action workflow YAML can
 * also be configured here so users never need to touch the workflow file
 * after initial setup.
 *
 * Supports:
 *   ignore           glob patterns to exclude files/dirs
 *   rules            per-type overrides (e.g. dead-code: off, lint: low)
 *   fix-types        which issue types to auto-fix
 *   test-command     override test runner
 *   strictness       low | medium | high
 *   min-severity     minimum severity to report/fix (critical | high | medium | low)
 *   fail-below       minimum passing score
 *   mode             scan | fix
 *   agent            claude | codex
 *   timeout          e.g. 30m, 2h
 *   max-cost         e.g. $5.00
 *   max-passes       max scan/fix iterations
 *   min-passes       min clean passes
 *   max-chains       max self-continuations
 *   model            override AI model
 *   github-models-model  model for free scan tier
 *   verbose          stream agent output
 *   max-turns        max agent turns
 *   max-issues-per-pass  cap issues per pass
 *   scan-scope       auto | pr | full
 *   output-file      path for issues JSON
 *   custom-prompt    inline prompt text
 *   custom-prompt-file   path to prompt file
 *   plugins          enable/disable plugin system
 *   parallel-agents  1-8
 *   app              application context (type, exposure, auth, network, data-sensitivity)
 *   framework        framework hint (e.g. next.js, express, django)
 *   runtime          runtime hint (e.g. node-20, python-3.12)
 *   trust-internal   list of trusted internal package patterns
 *   trust-untrusted  list of paths that handle untrusted input
 *   allow            false-positive suppression rules
 */

import * as core from '@actions/core';
import * as fs from 'fs';
import * as path from 'path';
import {
  RepoConfig,
  IssueType,
  Severity,
  AppContext,
  AppType,
  AppExposure,
  AppNetwork,
  DataSensitivity,
  AllowRule,
  ScanScope,
  AgentType,
  SloppyConfig,
} from './types';
import { parseSimpleYaml } from './plugins';

const VALID_TYPES = new Set<string>([
  'security', 'bugs', 'types', 'lint', 'dead-code', 'stubs', 'duplicates', 'coverage',
]);

const VALID_SEVERITIES = new Set<string>(['critical', 'high', 'medium', 'low']);
const VALID_APP_TYPES = new Set<string>(['web-app', 'api', 'cli', 'library', 'worker', 'mobile', 'desktop']);
const VALID_EXPOSURES = new Set<string>(['public', 'internal', 'local']);
const VALID_NETWORKS = new Set<string>(['internet', 'vpn', 'localhost']);
const VALID_DATA_SENSITIVITY = new Set<string>(['high', 'medium', 'low']);
const VALID_MODES = new Set<string>(['scan', 'fix']);
const VALID_AGENTS = new Set<string>(['claude', 'codex']);
const VALID_SCOPES = new Set<string>(['auto', 'pr', 'full']);

function parseYamlConfig(raw: string): RepoConfig {
  const data = parseSimpleYaml(raw);
  const config: RepoConfig = {};

  // --- Filtering ---

  // ignore: list of glob patterns
  if (Array.isArray(data.ignore)) {
    config.ignore = (data.ignore as string[]).filter(s => typeof s === 'string' && s.trim());
  }

  // rules: map of type → 'off' | severity
  if (data.rules && typeof data.rules === 'object') {
    const rules: Record<string, 'off' | Severity> = {};
    for (const [key, val] of Object.entries(data.rules as Record<string, string>)) {
      if (!VALID_TYPES.has(key)) continue;
      const v = String(val).toLowerCase();
      if (v === 'off' || VALID_SEVERITIES.has(v)) {
        rules[key] = v as 'off' | Severity;
      }
    }
    if (Object.keys(rules).length > 0) config.rules = rules;
  }

  // fix-types
  if (Array.isArray(data['fix-types'])) {
    config.fixTypes = (data['fix-types'] as string[]).filter(
      s => typeof s === 'string' && VALID_TYPES.has(s.trim()),
    ) as IssueType[];
  }

  // test-command
  if (typeof data['test-command'] === 'string' && data['test-command']) {
    config.testCommand = data['test-command'] as string;
  }

  // strictness
  if (typeof data.strictness === 'string') {
    const s = (data.strictness as string).toLowerCase();
    if (['low', 'medium', 'high'].includes(s)) {
      config.strictness = s as 'low' | 'medium' | 'high';
    }
  }

  // min-severity
  if (typeof data['min-severity'] === 'string') {
    const s = (data['min-severity'] as string).toLowerCase();
    if (VALID_SEVERITIES.has(s)) {
      config.minSeverity = s as Severity;
    }
  }

  // fail-below
  if (data['fail-below'] !== undefined) {
    const n = parseInt(String(data['fail-below']));
    if (!isNaN(n) && n >= 0 && n <= 100) config.failBelow = n;
  }

  // --- Operational settings ---

  if (typeof data.mode === 'string' && VALID_MODES.has(data.mode.toLowerCase())) {
    config.mode = data.mode.toLowerCase() as 'scan' | 'fix';
  }

  if (typeof data.agent === 'string' && VALID_AGENTS.has(data.agent.toLowerCase())) {
    config.agent = data.agent.toLowerCase() as AgentType;
  }

  if (typeof data.timeout === 'string' && data.timeout) {
    config.timeout = data.timeout;
  }

  if (typeof data['max-cost'] === 'string' && data['max-cost']) {
    config.maxCost = data['max-cost'];
  }

  if (data['max-passes'] !== undefined) {
    const n = parseInt(String(data['max-passes']));
    if (!isNaN(n) && n > 0) config.maxPasses = n;
  }

  if (data['min-passes'] !== undefined) {
    const n = parseInt(String(data['min-passes']));
    if (!isNaN(n) && n > 0) config.minPasses = n;
  }

  if (data['max-chains'] !== undefined) {
    const n = parseInt(String(data['max-chains']));
    if (!isNaN(n) && n >= 0) config.maxChains = n;
  }

  if (typeof data.model === 'string') {
    config.model = data.model;
  }

  if (typeof data['github-models-model'] === 'string' && data['github-models-model']) {
    config.githubModelsModel = data['github-models-model'];
  }

  if (typeof data.verbose === 'string') {
    config.verbose = data.verbose.toLowerCase() === 'true';
  }

  if (data['max-turns'] !== undefined) {
    const n = parseInt(String(data['max-turns']));
    if (!isNaN(n) && n > 0) config.maxTurns = n;
  }

  if (data['max-issues-per-pass'] !== undefined) {
    const n = parseInt(String(data['max-issues-per-pass']));
    if (!isNaN(n) && n >= 0) config.maxIssuesPerPass = n;
  }

  if (typeof data['scan-scope'] === 'string' && VALID_SCOPES.has(data['scan-scope'].toLowerCase())) {
    config.scanScope = data['scan-scope'].toLowerCase() as ScanScope;
  }

  if (typeof data['output-file'] === 'string') {
    config.outputFile = data['output-file'];
  }

  if (typeof data['custom-prompt'] === 'string' && data['custom-prompt']) {
    config.customPrompt = data['custom-prompt'];
  }

  if (typeof data['custom-prompt-file'] === 'string' && data['custom-prompt-file']) {
    config.customPromptFile = data['custom-prompt-file'];
  }

  if (typeof data.plugins === 'string') {
    config.plugins = data.plugins.toLowerCase() !== 'false';
  }

  if (data['parallel-agents'] !== undefined) {
    const n = parseInt(String(data['parallel-agents']));
    if (!isNaN(n) && n >= 1 && n <= 8) config.parallelAgents = n;
  }

  // --- App context ---

  if (data.app && typeof data.app === 'object') {
    const a = data.app as Record<string, string>;
    const app: AppContext = {};

    if (a.type && VALID_APP_TYPES.has(a.type.toLowerCase())) {
      app.type = a.type.toLowerCase() as AppType;
    }
    if (a.exposure && VALID_EXPOSURES.has(a.exposure.toLowerCase())) {
      app.exposure = a.exposure.toLowerCase() as AppExposure;
    }
    if (a.auth !== undefined) {
      app.auth = String(a.auth).toLowerCase() === 'true';
    }
    if (a.network && VALID_NETWORKS.has(a.network.toLowerCase())) {
      app.network = a.network.toLowerCase() as AppNetwork;
    }
    const ds = a['data-sensitivity'] || a.dataSensitivity;
    if (ds && VALID_DATA_SENSITIVITY.has(ds.toLowerCase())) {
      app.dataSensitivity = ds.toLowerCase() as DataSensitivity;
    }

    if (Object.keys(app).length > 0) config.app = app;
  }

  // framework
  if (typeof data.framework === 'string' && data.framework) {
    config.framework = data.framework;
  }

  // runtime
  if (typeof data.runtime === 'string' && data.runtime) {
    config.runtime = data.runtime;
  }

  // trust-internal
  if (Array.isArray(data['trust-internal'])) {
    config.trustInternal = (data['trust-internal'] as string[]).filter(s => typeof s === 'string' && s.trim());
  }

  // trust-untrusted
  if (Array.isArray(data['trust-untrusted'])) {
    config.trustUntrusted = (data['trust-untrusted'] as string[]).filter(s => typeof s === 'string' && s.trim());
  }

  // allow: list of { pattern, reason }
  if (Array.isArray(data.allow)) {
    const rules: AllowRule[] = [];
    for (const item of data.allow) {
      if (typeof item === 'object' && item !== null) {
        const obj = item as Record<string, string>;
        if (obj.pattern) {
          rules.push({ pattern: obj.pattern, reason: obj.reason || '' });
        }
      }
    }
    if (rules.length > 0) config.allow = rules;
  }

  return config;
}

export function loadRepoConfig(cwd: string): RepoConfig | null {
  const candidates = [
    path.join(cwd, '.sloppy.yml'),
    path.join(cwd, '.sloppy.yaml'),
    path.join(cwd, '.sloppy', 'config.yml'),
    path.join(cwd, '.sloppy', 'config.yaml'),
  ];

  let configPath: string | undefined;
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      configPath = p;
      break;
    }
  }

  if (!configPath) return null;

  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const config = parseYamlConfig(raw);
    core.info(`Loaded repo config from ${path.relative(cwd, configPath)}`);
    return config;
  } catch (e) {
    core.warning(`Failed to parse ${configPath}: ${e}`);
    return null;
  }
}

/**
 * Load a profile overlay from .sloppy/profiles/<name>.yml.
 * Profile files use the same format as .sloppy.yml. Values from the
 * profile override the base repo config.
 */
export function loadProfile(cwd: string, profileName: string): RepoConfig | null {
  if (!profileName) return null;

  const candidates = [
    path.join(cwd, '.sloppy', 'profiles', `${profileName}.yml`),
    path.join(cwd, '.sloppy', 'profiles', `${profileName}.yaml`),
  ];

  let profilePath: string | undefined;
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      profilePath = p;
      break;
    }
  }

  if (!profilePath) {
    core.warning(`Profile '${profileName}' not found in .sloppy/profiles/`);
    return null;
  }

  try {
    const raw = fs.readFileSync(profilePath, 'utf-8');
    const config = parseYamlConfig(raw);
    core.info(`Loaded profile '${profileName}' from ${path.relative(cwd, profilePath)}`);
    return config;
  } catch (e) {
    core.warning(`Failed to parse profile '${profileName}': ${e}`);
    return null;
  }
}

/**
 * Apply a profile overlay on top of a base repo config.
 * Profile values override base values (non-undefined fields win).
 */
export function applyProfile(base: RepoConfig, profile: RepoConfig): RepoConfig {
  const merged = { ...base };

  if (profile.ignore) merged.ignore = profile.ignore;
  if (profile.rules) merged.rules = { ...base.rules, ...profile.rules };
  if (profile.fixTypes) merged.fixTypes = profile.fixTypes;
  if (profile.testCommand) merged.testCommand = profile.testCommand;
  if (profile.strictness) merged.strictness = profile.strictness;
  if (profile.minSeverity) merged.minSeverity = profile.minSeverity;
  if (profile.failBelow !== undefined) merged.failBelow = profile.failBelow;
  if (profile.mode) merged.mode = profile.mode;
  if (profile.agent) merged.agent = profile.agent;
  if (profile.timeout) merged.timeout = profile.timeout;
  if (profile.maxCost) merged.maxCost = profile.maxCost;
  if (profile.maxPasses !== undefined) merged.maxPasses = profile.maxPasses;
  if (profile.minPasses !== undefined) merged.minPasses = profile.minPasses;
  if (profile.maxChains !== undefined) merged.maxChains = profile.maxChains;
  if (profile.model !== undefined) merged.model = profile.model;
  if (profile.githubModelsModel) merged.githubModelsModel = profile.githubModelsModel;
  if (profile.verbose !== undefined) merged.verbose = profile.verbose;
  if (profile.maxTurns !== undefined) merged.maxTurns = profile.maxTurns;
  if (profile.maxIssuesPerPass !== undefined) merged.maxIssuesPerPass = profile.maxIssuesPerPass;
  if (profile.scanScope) merged.scanScope = profile.scanScope;
  if (profile.outputFile !== undefined) merged.outputFile = profile.outputFile;
  if (profile.parallelAgents !== undefined) merged.parallelAgents = profile.parallelAgents;
  if (profile.app) merged.app = { ...base.app, ...profile.app };
  if (profile.framework) merged.framework = profile.framework;
  if (profile.runtime) merged.runtime = profile.runtime;
  if (profile.trustInternal) merged.trustInternal = profile.trustInternal;
  if (profile.trustUntrusted) merged.trustUntrusted = profile.trustUntrusted;
  if (profile.allow) merged.allow = profile.allow;

  return merged;
}

// Helper: check if an action input was left at its default value
function isDefault(actual: string, defaultVal: string): boolean {
  return !actual || actual === defaultVal;
}

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

/**
 * Merge a RepoConfig into the runtime SloppyConfig.
 * Repo config values override action.yml defaults but NOT explicit user inputs.
 */
export function mergeRepoConfig(
  config: SloppyConfig,
  repo: RepoConfig,
  actionInputs: Record<string, string>,
): void {
  // Only override if the action input was left at default (empty / default value)

  // Filtering
  if (isDefault(actionInputs['test-command'], '') && repo.testCommand) {
    config.testCommand = repo.testCommand;
  }
  if (isDefault(actionInputs['strictness'], 'high') && repo.strictness) {
    config.strictness = repo.strictness;
  }
  if (repo.fixTypes && repo.fixTypes.length > 0 && isDefault(actionInputs['fix-types'], 'security,bugs,types,lint,dead-code,stubs,duplicates,coverage')) {
    config.fixTypes = repo.fixTypes;
  }
  if (isDefault(actionInputs['fail-below'], '0') && repo.failBelow !== undefined) {
    config.failBelow = repo.failBelow;
  }
  if (isDefault(actionInputs['min-severity'], 'low') && repo.minSeverity) {
    config.minSeverity = repo.minSeverity;
  }

  // Operational
  if (isDefault(actionInputs['mode'], '') && repo.mode) {
    config.mode = repo.mode;
  }
  if (isDefault(actionInputs['agent'], 'claude') && repo.agent) {
    config.agent = repo.agent;
  }
  if (isDefault(actionInputs['timeout'], '30m') && repo.timeout) {
    config.timeout = parseTimeout(repo.timeout);
  }
  if (isDefault(actionInputs['max-cost'], '$5.00') && repo.maxCost) {
    config.maxCost = parseFloat(repo.maxCost.replace('$', '')) || 5;
  }
  if (isDefault(actionInputs['max-passes'], '10') && repo.maxPasses !== undefined) {
    config.maxPasses = repo.maxPasses;
  }
  if (isDefault(actionInputs['min-passes'], '2') && repo.minPasses !== undefined) {
    config.minPasses = repo.minPasses;
  }
  if (isDefault(actionInputs['max-chains'], '3') && repo.maxChains !== undefined) {
    config.maxChains = repo.maxChains;
  }
  if (isDefault(actionInputs['model'], '') && repo.model !== undefined) {
    config.model = repo.model;
  }
  if (isDefault(actionInputs['github-models-model'], 'openai/gpt-4o-mini') && repo.githubModelsModel) {
    config.githubModelsModel = repo.githubModelsModel;
  }
  if (isDefault(actionInputs['verbose'], 'false') && repo.verbose !== undefined) {
    config.verbose = repo.verbose;
  }
  if (isDefault(actionInputs['max-turns'], '') && repo.maxTurns !== undefined) {
    config.maxTurns = { scan: repo.maxTurns, fix: Math.round(repo.maxTurns / 2) };
  }
  if (isDefault(actionInputs['max-issues-per-pass'], '0') && repo.maxIssuesPerPass !== undefined) {
    config.maxIssuesPerPass = repo.maxIssuesPerPass;
  }
  if (isDefault(actionInputs['scan-scope'], 'auto') && repo.scanScope) {
    config.scanScope = repo.scanScope;
  }
  if (isDefault(actionInputs['output-file'], '') && repo.outputFile) {
    config.outputFile = repo.outputFile;
  }
  if (isDefault(actionInputs['custom-prompt'], '') && repo.customPrompt) {
    config.customPrompt = repo.customPrompt;
  }
  if (isDefault(actionInputs['custom-prompt-file'], '') && repo.customPromptFile) {
    config.customPromptFile = repo.customPromptFile;
  }
  if (isDefault(actionInputs['plugins'], 'true') && repo.plugins !== undefined) {
    config.pluginsEnabled = repo.plugins;
  }
  if (isDefault(actionInputs['parallel-agents'], '3') && repo.parallelAgents !== undefined) {
    config.parallelAgents = Math.min(Math.max(repo.parallelAgents, 1), 8);
  }

  // App context (always merge from repo config — no action input equivalent)
  if (repo.app) {
    config.app = { ...config.app, ...repo.app };
  }
  if (repo.framework) config.framework = repo.framework;
  if (repo.runtime) config.runtime = repo.runtime;
  if (repo.trustInternal) config.trustInternal = repo.trustInternal;
  if (repo.trustUntrusted) config.trustUntrusted = repo.trustUntrusted;
  if (repo.allow) config.allow = repo.allow;
}
