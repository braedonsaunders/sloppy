import { BaseAnalyzer, type Issue, type AnalyzerOptions, type IssueCategory } from './base.js';

export interface AnalyzerPluginManifest {
  name: string;
  version: string;
  description: string;
  author?: string;
  homepage?: string;
  category: string;
  supportedLanguages?: string[];
  tags?: string[];
}

export interface AnalyzerPlugin {
  manifest: AnalyzerPluginManifest;
  analyzer: BaseAnalyzer;
}

export class PluginValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PluginValidationError';
  }
}

export class PluginRegistry {
  private plugins: Map<string, AnalyzerPlugin> = new Map();
  private static instance: PluginRegistry | null = null;

  static getInstance(): PluginRegistry {
    if (!PluginRegistry.instance) {
      PluginRegistry.instance = new PluginRegistry();
    }
    return PluginRegistry.instance;
  }

  register(plugin: AnalyzerPlugin): void {
    validatePlugin(plugin);
    if (this.plugins.has(plugin.manifest.name)) {
      throw new Error(`Plugin "${plugin.manifest.name}" is already registered`);
    }
    this.plugins.set(plugin.manifest.name, plugin);
  }

  unregister(name: string): boolean {
    return this.plugins.delete(name);
  }

  get(name: string): AnalyzerPlugin | undefined {
    return this.plugins.get(name);
  }

  list(): AnalyzerPlugin[] {
    return Array.from(this.plugins.values());
  }

  getAnalyzers(): BaseAnalyzer[] {
    return this.list().map(p => p.analyzer);
  }

  has(name: string): boolean {
    return this.plugins.has(name);
  }

  clear(): void {
    this.plugins.clear();
  }
}

export function validatePlugin(plugin: AnalyzerPlugin): void {
  if (!plugin.manifest) {
    throw new PluginValidationError('Plugin must have a manifest');
  }
  if (!plugin.manifest.name || typeof plugin.manifest.name !== 'string') {
    throw new PluginValidationError('Plugin manifest must have a name');
  }
  if (!plugin.manifest.version || typeof plugin.manifest.version !== 'string') {
    throw new PluginValidationError('Plugin manifest must have a version');
  }
  if (!plugin.manifest.description || typeof plugin.manifest.description !== 'string') {
    throw new PluginValidationError('Plugin manifest must have a description');
  }
  if (!plugin.analyzer) {
    throw new PluginValidationError('Plugin must have an analyzer instance');
  }
  if (typeof plugin.analyzer.analyze !== 'function') {
    throw new PluginValidationError('Plugin analyzer must implement analyze()');
  }
  if (!plugin.analyzer.name || !plugin.analyzer.category) {
    throw new PluginValidationError('Plugin analyzer must have name and category properties');
  }
}

export async function loadPluginFromPath(pluginPath: string): Promise<AnalyzerPlugin> {
  try {
    const module = await import(pluginPath);
    const plugin = module.default ?? module;

    if (typeof plugin === 'function') {
      // Plugin exports a class - instantiate it
      const instance = new plugin();
      return {
        manifest: instance.manifest ?? {
          name: instance.name,
          version: '0.0.0',
          description: instance.description ?? 'Unknown plugin',
          category: instance.category,
        },
        analyzer: instance,
      };
    }

    // Plugin exports an object with manifest and analyzer
    validatePlugin(plugin);
    return plugin;
  } catch (error) {
    throw new PluginValidationError(
      `Failed to load plugin from ${pluginPath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function loadPluginsFromDirectory(dirPath: string): Promise<AnalyzerPlugin[]> {
  const { readdir } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { pathToFileURL } = await import('node:url');

  const plugins: AnalyzerPlugin[] = [];

  try {
    const entries = await readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.mjs'))) {
        try {
          const fullPath = pathToFileURL(join(dirPath, entry.name)).href;
          const plugin = await loadPluginFromPath(fullPath);
          plugins.push(plugin);
        } catch (error) {
          console.warn(`[plugin-registry] Failed to load plugin ${entry.name}:`, error);
        }
      }
    }
  } catch (error) {
    console.warn(`[plugin-registry] Failed to read plugins directory ${dirPath}:`, error);
  }

  return plugins;
}

// Convenience function to create a plugin from just an analyzer
export function createPlugin(
  analyzer: BaseAnalyzer,
  manifest?: Partial<AnalyzerPluginManifest>
): AnalyzerPlugin {
  return {
    manifest: {
      name: manifest?.name ?? analyzer.name,
      version: manifest?.version ?? '1.0.0',
      description: manifest?.description ?? analyzer.description,
      category: manifest?.category ?? analyzer.category,
      author: manifest?.author,
      homepage: manifest?.homepage,
      supportedLanguages: manifest?.supportedLanguages,
      tags: manifest?.tags,
    },
    analyzer,
  };
}
