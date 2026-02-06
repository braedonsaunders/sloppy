/**
 * Plugin system for Sloppy.
 *
 * Plugins live in `.sloppy/plugins/` as YAML manifests (plugin.yml).
 * Each plugin can contribute:
 *   - Custom prompt text injected into scan/fix prompts
 *   - Regex patterns for Layer 0 local scanning
 *   - Lifecycle hooks (shell commands) at pre-scan, post-scan, pre-fix, post-fix
 *   - Issue filters (exclude paths, types, set minimum severity)
 *
 * Users can also inject custom prompt text directly via the `custom-prompt`
 * action input or a `custom-prompt-file`, or by convention via `.sloppy/prompt.md`.
 */

import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as fs from 'fs';
import * as path from 'path';
import {
  SloppyPlugin,
  PluginPattern,
  PluginHooks,
  PluginFilters,
  PluginContext,
  Issue,
  Severity,
} from './types';

// ---------------------------------------------------------------------------
// YAML subset parser — handles the plugin.yml format without adding a
// dependency. Supports scalars, lists, and one level of nesting.
// ---------------------------------------------------------------------------

export function parseSimpleYaml(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = text.split('\n');
  let currentKey = '';
  let currentList: unknown[] | null = null;
  let currentMap: Record<string, unknown> | null = null;
  let inMultiline = false;
  let multilineValue = '';

  for (const rawLine of lines) {
    // Skip comments and empty lines (unless in multiline)
    if (!inMultiline && (rawLine.trim().startsWith('#') || rawLine.trim() === '')) {
      continue;
    }

    // Handle multiline block scalar (|)
    if (inMultiline) {
      if (rawLine.startsWith('  ') || rawLine.startsWith('\t') || rawLine.trim() === '') {
        multilineValue += rawLine.replace(/^ {2}/, '') + '\n';
        continue;
      } else {
        // End of block — store value
        if (currentMap) {
          currentMap[currentKey] = multilineValue.trimEnd();
        } else {
          result[currentKey] = multilineValue.trimEnd();
        }
        inMultiline = false;
        multilineValue = '';
      }
    }

    // Top-level key (no leading whitespace)
    const topMatch = rawLine.match(/^([a-zA-Z_-]+)\s*:\s*(.*)/);
    if (topMatch && !rawLine.startsWith(' ') && !rawLine.startsWith('\t')) {
      // Flush any pending list/map
      if (currentList) {
        result[currentKey] = currentList;
        currentList = null;
      }
      if (currentMap) {
        result[currentKey] = currentMap;
        currentMap = null;
      }

      currentKey = topMatch[1];
      const val = topMatch[2].trim();

      if (val === '|') {
        inMultiline = true;
        multilineValue = '';
      } else if (val === '' || val === '[]') {
        // Will be filled by subsequent indented lines
        if (val === '[]') result[currentKey] = [];
      } else {
        result[currentKey] = stripQuotes(val);
      }
      continue;
    }

    // List item at top level (  - value)
    const listMatch = rawLine.match(/^\s+-\s+(.*)/);
    if (listMatch && !rawLine.match(/^\s+-\s+\w+\s*:/)) {
      if (!currentList) currentList = [];
      currentList.push(stripQuotes(listMatch[1].trim()));
      continue;
    }

    // List item that starts a map (  - key: value)
    const listMapMatch = rawLine.match(/^\s+-\s+(\w[\w-]*)\s*:\s*(.*)/);
    if (listMapMatch) {
      if (!currentList) currentList = [];
      const obj: Record<string, string> = {};
      obj[listMapMatch[1]] = stripQuotes(listMapMatch[2].trim());
      currentList.push(obj);
      continue;
    }

    // Nested key:value under current context (  key: value)
    const nestedMatch = rawLine.match(/^\s+([a-zA-Z_-]+)\s*:\s*(.*)/);
    if (nestedMatch) {
      // If the last list item is an object, add to it
      if (currentList && currentList.length > 0 && typeof currentList[currentList.length - 1] === 'object') {
        (currentList[currentList.length - 1] as Record<string, string>)[nestedMatch[1]] = stripQuotes(nestedMatch[2].trim());
      } else {
        // Start a nested map
        if (!currentMap) currentMap = {};
        const val = nestedMatch[2].trim();
        if (val === '|') {
          inMultiline = true;
          multilineValue = '';
        } else {
          currentMap[nestedMatch[1]] = stripQuotes(val);
        }
      }
    }
  }

  // Flush trailing values
  if (inMultiline) {
    if (currentMap) {
      currentMap[currentKey] = multilineValue.trimEnd();
    } else {
      result[currentKey] = multilineValue.trimEnd();
    }
  }
  if (currentList) result[currentKey] = currentList;
  if (currentMap) result[currentKey] = currentMap;

  return result;
}

function stripQuotes(s: string): string {
  if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) {
    return s.slice(1, -1);
  }
  return s;
}

// ---------------------------------------------------------------------------
// Plugin loading
// ---------------------------------------------------------------------------

function loadPluginManifest(pluginDir: string): SloppyPlugin | null {
  const manifestPath = path.join(pluginDir, 'plugin.yml');
  if (!fs.existsSync(manifestPath)) return null;

  try {
    const raw = fs.readFileSync(manifestPath, 'utf-8');
    const data = parseSimpleYaml(raw);

    const plugin: SloppyPlugin = {
      name: (data.name as string) || path.basename(pluginDir),
      version: data.version as string | undefined,
      description: data.description as string | undefined,
      prompt: data.prompt as string | undefined,
      _dir: pluginDir,
    };

    // Parse patterns
    if (Array.isArray(data.patterns)) {
      plugin.patterns = (data.patterns as Record<string, string>[]).map(p => ({
        regex: p.regex || '',
        type: p.type || 'lint',
        severity: (p.severity || 'medium') as Severity,
        description: p.description || '',
        extensions: p.extensions
          ? (typeof p.extensions === 'string' ? p.extensions.split(',').map(s => s.trim()) : undefined)
          : undefined,
      })).filter(p => p.regex);
    }

    // Parse hooks
    if (data.hooks && typeof data.hooks === 'object') {
      const h = data.hooks as Record<string, string>;
      plugin.hooks = {};
      for (const key of ['pre-scan', 'post-scan', 'pre-fix', 'post-fix'] as const) {
        if (h[key]) plugin.hooks[key] = h[key];
      }
    }

    // Parse filters
    if (data.filters && typeof data.filters === 'object') {
      const f = data.filters as Record<string, unknown>;
      plugin.filters = {};
      if (Array.isArray(f['exclude-paths'])) {
        plugin.filters['exclude-paths'] = f['exclude-paths'] as string[];
      }
      if (Array.isArray(f['exclude-types'])) {
        plugin.filters['exclude-types'] = f['exclude-types'] as string[];
      }
      if (f['min-severity']) {
        plugin.filters['min-severity'] = f['min-severity'] as Severity;
      }
    }

    return plugin;
  } catch (e) {
    core.warning(`Failed to load plugin from ${pluginDir}: ${e}`);
    return null;
  }
}

/** Load a single-file plugin (a .yml file directly in the plugins dir). */
function loadSingleFilePlugin(filePath: string): SloppyPlugin | null {
  if (!filePath.endsWith('.yml') && !filePath.endsWith('.yaml')) return null;
  if (path.basename(filePath) === 'plugin.yml') return null;

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = parseSimpleYaml(raw);
    const name = path.basename(filePath, path.extname(filePath));

    const plugin: SloppyPlugin = {
      name: (data.name as string) || name,
      _dir: path.dirname(filePath),
    };

    if (data.prompt) plugin.prompt = data.prompt as string;

    if (Array.isArray(data.patterns)) {
      plugin.patterns = (data.patterns as Record<string, string>[]).map(p => ({
        regex: p.regex || '',
        type: p.type || 'lint',
        severity: (p.severity || 'medium') as Severity,
        description: p.description || '',
        extensions: p.extensions
          ? (typeof p.extensions === 'string' ? p.extensions.split(',').map(s => s.trim()) : undefined)
          : undefined,
      })).filter(p => p.regex);
    }

    if (data.hooks && typeof data.hooks === 'object') {
      const h = data.hooks as Record<string, string>;
      plugin.hooks = {};
      for (const key of ['pre-scan', 'post-scan', 'pre-fix', 'post-fix'] as const) {
        if (h[key]) plugin.hooks[key] = h[key];
      }
    }

    if (data.filters && typeof data.filters === 'object') {
      const f = data.filters as Record<string, unknown>;
      plugin.filters = {};
      if (Array.isArray(f['exclude-paths'])) plugin.filters['exclude-paths'] = f['exclude-paths'] as string[];
      if (Array.isArray(f['exclude-types'])) plugin.filters['exclude-types'] = f['exclude-types'] as string[];
      if (f['min-severity']) plugin.filters['min-severity'] = f['min-severity'] as Severity;
    }

    return plugin;
  } catch (e) {
    core.warning(`Failed to load plugin file ${filePath}: ${e}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve custom prompt text from all sources (in priority order):
 *   1. `custom-prompt` action input (inline text)
 *   2. `custom-prompt-file` action input (path to a file)
 *   3. `.sloppy/prompt.md` convention file
 *
 * All sources are concatenated (not overridden) so they compose.
 */
export function resolveCustomPrompt(
  customPromptInput: string,
  customPromptFile: string,
  cwd: string,
): string {
  const parts: string[] = [];

  // 1. Inline input
  if (customPromptInput.trim()) {
    parts.push(customPromptInput.trim());
  }

  // 2. File input
  if (customPromptFile.trim()) {
    const filePath = path.isAbsolute(customPromptFile)
      ? customPromptFile
      : path.join(cwd, customPromptFile);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8').trim();
      if (content) parts.push(content);
    } else {
      core.warning(`custom-prompt-file not found: ${filePath}`);
    }
  }

  // 3. Convention: .sloppy/prompt.md
  const conventionPath = path.join(cwd, '.sloppy', 'prompt.md');
  if (fs.existsSync(conventionPath)) {
    const content = fs.readFileSync(conventionPath, 'utf-8').trim();
    if (content) parts.push(content);
  }

  return parts.join('\n\n');
}

/**
 * Load all plugins from `.sloppy/plugins/`.
 *
 * Supports two layouts:
 *   - Directory plugin: `.sloppy/plugins/my-plugin/plugin.yml`
 *   - Single-file plugin: `.sloppy/plugins/my-rules.yml`
 */
export function loadPlugins(cwd: string): SloppyPlugin[] {
  const pluginsDir = path.join(cwd, '.sloppy', 'plugins');
  if (!fs.existsSync(pluginsDir)) return [];

  const plugins: SloppyPlugin[] = [];

  for (const entry of fs.readdirSync(pluginsDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const plugin = loadPluginManifest(path.join(pluginsDir, entry.name));
      if (plugin) plugins.push(plugin);
    } else if (entry.isFile()) {
      const plugin = loadSingleFilePlugin(path.join(pluginsDir, entry.name));
      if (plugin) plugins.push(plugin);
    }
  }

  return plugins;
}

/**
 * Build the aggregated PluginContext from all sources.
 */
export function buildPluginContext(
  plugins: SloppyPlugin[],
  customPrompt: string,
): PluginContext {
  const promptParts: string[] = [];
  if (customPrompt) promptParts.push(customPrompt);

  const extraPatterns: PluginPattern[] = [];
  const mergedFilters: PluginFilters = {};

  const excludePaths: string[] = [];
  const excludeTypes: string[] = [];
  let minSeverity: Severity | undefined;

  const SEVERITY_RANK: Record<string, number> = { critical: 3, high: 2, medium: 1, low: 0 };

  for (const plugin of plugins) {
    if (plugin.prompt) promptParts.push(plugin.prompt);
    if (plugin.patterns) extraPatterns.push(...plugin.patterns);

    if (plugin.filters) {
      if (plugin.filters['exclude-paths']) excludePaths.push(...plugin.filters['exclude-paths']);
      if (plugin.filters['exclude-types']) excludeTypes.push(...plugin.filters['exclude-types']);
      if (plugin.filters['min-severity']) {
        const rank = SEVERITY_RANK[plugin.filters['min-severity']] ?? 0;
        if (!minSeverity || rank > (SEVERITY_RANK[minSeverity] ?? 0)) {
          minSeverity = plugin.filters['min-severity'];
        }
      }
    }
  }

  if (excludePaths.length > 0) mergedFilters['exclude-paths'] = [...new Set(excludePaths)];
  if (excludeTypes.length > 0) mergedFilters['exclude-types'] = [...new Set(excludeTypes)];
  if (minSeverity) mergedFilters['min-severity'] = minSeverity;

  return {
    plugins,
    customPrompt: promptParts.join('\n\n'),
    extraPatterns,
    filters: mergedFilters,
  };
}

// ---------------------------------------------------------------------------
// Hook execution
// ---------------------------------------------------------------------------

/**
 * Run a lifecycle hook across all plugins that define it.
 * Hooks run sequentially in plugin load order. A non-zero exit code
 * logs a warning but does not abort the run.
 */
export async function runHook(
  plugins: SloppyPlugin[],
  hook: keyof PluginHooks,
  env?: Record<string, string>,
): Promise<void> {
  for (const plugin of plugins) {
    const cmd = plugin.hooks?.[hook];
    if (!cmd) continue;

    const resolvedCmd = path.isAbsolute(cmd) ? cmd : path.join(plugin._dir, cmd);
    core.info(`  [plugin:${plugin.name}] Running ${hook} hook...`);

    try {
      const exitCode = await exec.exec('sh', ['-c', resolvedCmd], {
        ignoreReturnCode: true,
        silent: true,
        env: { ...process.env, ...env } as Record<string, string>,
        cwd: plugin._dir,
      });
      if (exitCode !== 0) {
        core.warning(`  [plugin:${plugin.name}] ${hook} hook exited with code ${exitCode}`);
      }
    } catch (e) {
      core.warning(`  [plugin:${plugin.name}] ${hook} hook failed: ${e}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Issue filtering
// ---------------------------------------------------------------------------

const SEVERITY_RANK: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };

/**
 * Apply plugin filters to a list of issues.
 * Removes issues matching exclude rules or below minimum severity.
 */
export function applyFilters(issues: Issue[], filters: PluginFilters): Issue[] {
  if (!filters || Object.keys(filters).length === 0) return issues;

  const excludePaths = filters['exclude-paths'] || [];
  const excludeTypes = new Set(filters['exclude-types'] || []);
  const minRank = filters['min-severity'] ? (SEVERITY_RANK[filters['min-severity']] ?? 0) : 0;

  return issues.filter(issue => {
    // Check type exclusion
    if (excludeTypes.has(issue.type)) return false;

    // Check severity minimum
    if (minRank > 0 && (SEVERITY_RANK[issue.severity] ?? 0) < minRank) return false;

    // Check path exclusion (simple glob: * matches anything, ** matches dirs)
    if (excludePaths.length > 0) {
      for (const pattern of excludePaths) {
        if (matchGlob(issue.file, pattern)) return false;
      }
    }

    return true;
  });
}

/** Simple glob matcher supporting * and **. */
function matchGlob(filepath: string, pattern: string): boolean {
  const regexStr = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '{{DOUBLESTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/\{\{DOUBLESTAR\}\}/g, '.*');
  return new RegExp(`^${regexStr}$`).test(filepath);
}

/**
 * Format the custom prompt section for injection into scan/fix prompts.
 * Returns empty string if no custom content.
 */
export function formatCustomPromptSection(ctx: PluginContext): string {
  if (!ctx.customPrompt) return '';
  return `\nCUSTOM RULES (from user configuration and plugins):\n${ctx.customPrompt}\n`;
}
