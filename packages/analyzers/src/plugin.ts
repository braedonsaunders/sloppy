import { BaseAnalyzer } from './base.js';

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
  private plugins = new Map<string, AnalyzerPlugin>();
  private static instance: PluginRegistry | null = null;

  static getInstance(): PluginRegistry {
    PluginRegistry.instance ??= new PluginRegistry();
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
  if (typeof plugin.manifest.name !== 'string' || plugin.manifest.name === '') {
    throw new PluginValidationError('Plugin manifest must have a name');
  }
  if (typeof plugin.manifest.version !== 'string' || plugin.manifest.version === '') {
    throw new PluginValidationError('Plugin manifest must have a version');
  }
  if (typeof plugin.manifest.description !== 'string' || plugin.manifest.description === '') {
    throw new PluginValidationError('Plugin manifest must have a description');
  }
  if (typeof plugin.analyzer.analyze !== 'function') {
    throw new PluginValidationError('Plugin analyzer must implement analyze()');
  }
}

interface PluginModule {
  default?: unknown;
  manifest?: AnalyzerPluginManifest;
  analyzer?: BaseAnalyzer;
}

function isAnalyzerPlugin(value: unknown): value is AnalyzerPlugin {
  return (
    typeof value === 'object' &&
    value !== null &&
    'manifest' in value &&
    'analyzer' in value &&
    typeof (value as AnalyzerPlugin).manifest === 'object' &&
    typeof (value as AnalyzerPlugin).analyzer === 'object'
  );
}

export async function loadPluginFromPath(pluginPath: string): Promise<AnalyzerPlugin> {
  try {
    const loaded = (await import(pluginPath)) as PluginModule;
    const pluginExport = loaded.default ?? loaded;

    if (isAnalyzerPlugin(pluginExport)) {
      validatePlugin(pluginExport);
      return pluginExport;
    }

    throw new PluginValidationError(
      'Plugin must export an object with manifest and analyzer properties'
    );
  } catch (error) {
    if (error instanceof PluginValidationError) {
      throw error;
    }
    throw new PluginValidationError(
      `Failed to load plugin from ${pluginPath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function loadPluginsFromDirectory(dirPath: string): Promise<AnalyzerPlugin[]> {
  const fsPromises = await import('node:fs/promises');
  const nodePath = await import('node:path');
  const nodeUrl = await import('node:url');

  const plugins: AnalyzerPlugin[] = [];

  try {
    const entries = await fsPromises.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.mjs'))) {
        try {
          const fullPath = nodeUrl.pathToFileURL(nodePath.join(dirPath, entry.name)).href;
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
