/**
 * .sloppy.yml repo config loader.
 *
 * Supports:
 *   ignore:       glob patterns to exclude files/dirs from scanning and fixing
 *   rules:        per-type overrides (e.g. dead-code: off, lint: low)
 *   fix-types:    which issue types to auto-fix
 *   test-command:  override test runner
 *   strictness:   low | medium | high
 *   fail-below:   minimum passing score
 */

import * as core from '@actions/core';
import * as fs from 'fs';
import * as path from 'path';
import { RepoConfig, IssueType, Severity } from './types';
import { parseSimpleYaml } from './plugins';

const VALID_TYPES = new Set<string>([
  'security', 'bugs', 'types', 'lint', 'dead-code', 'stubs', 'duplicates', 'coverage',
]);

const VALID_SEVERITIES = new Set<string>(['critical', 'high', 'medium', 'low']);

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
    const data = parseSimpleYaml(raw);
    const config: RepoConfig = {};

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

    // fail-below
    if (data['fail-below'] !== undefined) {
      const n = parseInt(String(data['fail-below']));
      if (!isNaN(n) && n >= 0 && n <= 100) config.failBelow = n;
    }

    core.info(`Loaded repo config from ${path.relative(cwd, configPath)}`);
    return config;
  } catch (e) {
    core.warning(`Failed to parse ${configPath}: ${e}`);
    return null;
  }
}

/**
 * Merge a RepoConfig into the runtime SloppyConfig.
 * Repo config values override action.yml defaults but NOT explicit user inputs.
 */
export function mergeRepoConfig(
  config: {
    testCommand: string;
    strictness: string;
    fixTypes: IssueType[];
    failBelow: number;
  },
  repo: RepoConfig,
): void {
  // Only override if the action input was left at default (empty / default value)
  if (!config.testCommand && repo.testCommand) {
    config.testCommand = repo.testCommand;
  }
  if (config.strictness === 'high' && repo.strictness) {
    config.strictness = repo.strictness;
  }
  if (repo.fixTypes && repo.fixTypes.length > 0) {
    config.fixTypes = repo.fixTypes;
  }
  if (config.failBelow === 0 && repo.failBelow !== undefined) {
    config.failBelow = repo.failBelow;
  }
}
