/**
 * Configuration Utility
 *
 * Functions to load and validate sloppy.config.json from a repository.
 * Supports JSON and JavaScript configuration files.
 */

import { readFile, access, constants } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import type { SessionConfig } from '../types/session.js';
import type { ProviderConfig, ProviderType } from '../types/provider.js';

/**
 * Sloppy configuration file structure.
 */
export interface SloppyConfig {
  /**
   * Schema version for the configuration.
   * @default 1
   */
  version?: number;

  /**
   * Default session configuration.
   */
  session?: Partial<SessionConfig>;

  /**
   * Provider configurations.
   */
  providers?: Partial<ProviderConfig>[];

  /**
   * Default provider ID to use.
   */
  defaultProvider?: string;

  /**
   * Global ignore patterns (in addition to session-specific ones).
   */
  ignorePatterns?: string[];

  /**
   * Custom commands for the project.
   */
  commands?: {
    test?: string;
    lint?: string;
    build?: string;
    typecheck?: string;
  };

  /**
   * Plugin configurations.
   */
  plugins?: {
    name: string;
    options?: Record<string, unknown>;
  }[];

  /**
   * Project-specific settings.
   */
  project?: {
    name?: string;
    type?: 'node' | 'browser' | 'fullstack' | 'library';
    framework?: string;
    language?: 'typescript' | 'javascript';
  };

  /**
   * Custom rules for issue detection.
   */
  rules?: Record<
    string,
    {
      enabled: boolean;
      severity?: 'low' | 'medium' | 'high' | 'critical';
      options?: Record<string, unknown>;
    }
  >;
}

/**
 * Configuration file names to search for (in order of priority).
 */
export const CONFIG_FILE_NAMES = [
  'sloppy.config.json',
  'sloppy.config.js',
  'sloppy.config.mjs',
  '.sloppyrc',
  '.sloppyrc.json',
] as const;

/**
 * Result of loading configuration.
 */
export interface ConfigLoadResult {
  /**
   * The loaded configuration.
   */
  config: SloppyConfig;

  /**
   * Path to the configuration file.
   */
  filePath: string;

  /**
   * Any warnings during loading.
   */
  warnings: string[];
}

/**
 * Configuration validation error.
 */
export class ConfigValidationError extends Error {
  constructor(
    message: string,
    public readonly errors: string[]
  ) {
    super(message);
    this.name = 'ConfigValidationError';
  }
}

/**
 * Check if a file exists and is readable.
 *
 * @param filePath - Path to check
 * @returns True if file exists and is readable
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Find the configuration file in a directory or its parents.
 *
 * @param startDir - Directory to start searching from
 * @param maxDepth - Maximum parent directories to search
 * @returns Path to config file or undefined
 */
export async function findConfigFile(
  startDir: string,
  maxDepth = 10
): Promise<string | undefined> {
  let currentDir = resolve(startDir);
  let depth = 0;

  while (depth < maxDepth) {
    for (const fileName of CONFIG_FILE_NAMES) {
      const filePath = join(currentDir, fileName);
      if (await fileExists(filePath)) {
        return filePath;
      }
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      // Reached root
      break;
    }

    currentDir = parentDir;
    depth++;
  }

  return undefined;
}

/**
 * Load configuration from a JSON file.
 *
 * @param filePath - Path to the config file
 * @returns Parsed configuration
 */
async function loadJsonConfig(filePath: string): Promise<SloppyConfig> {
  const content = await readFile(filePath, 'utf-8');

  try {
    return JSON.parse(content) as SloppyConfig;
  } catch (error) {
    throw new Error(
      `Failed to parse configuration file ${filePath}: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`
    );
  }
}

/**
 * Load configuration from a JavaScript file.
 *
 * @param filePath - Path to the config file
 * @returns Parsed configuration
 */
async function loadJsConfig(filePath: string): Promise<SloppyConfig> {
  try {
    const module = (await import(filePath)) as { default?: SloppyConfig } & SloppyConfig;
    return module.default ?? module;
  } catch (error) {
    throw new Error(
      `Failed to load configuration file ${filePath}: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`
    );
  }
}

/**
 * Validate a configuration object.
 *
 * @param config - Configuration to validate
 * @returns Array of validation errors (empty if valid)
 */
export function validateConfig(config: SloppyConfig): string[] {
  const errors: string[] = [];

  // Validate version
  if (config.version !== undefined && typeof config.version !== 'number') {
    errors.push('version must be a number');
  }

  // Validate session config
  if (config.session) {
    if (
      config.session.strictness &&
      !['low', 'medium', 'high'].includes(config.session.strictness)
    ) {
      errors.push('session.strictness must be "low", "medium", or "high"');
    }

    if (
      config.session.maxAttemptsPerIssue !== undefined &&
      (typeof config.session.maxAttemptsPerIssue !== 'number' ||
        config.session.maxAttemptsPerIssue < 1)
    ) {
      errors.push('session.maxAttemptsPerIssue must be a positive number');
    }

    if (
      config.session.concurrency !== undefined &&
      (typeof config.session.concurrency !== 'number' ||
        config.session.concurrency < 1)
    ) {
      errors.push('session.concurrency must be a positive number');
    }
  }

  // Validate providers
  if (config.providers) {
    if (!Array.isArray(config.providers)) {
      errors.push('providers must be an array');
    } else {
      config.providers.forEach((provider, index) => {
        if (provider.type === undefined) {
          errors.push(`providers[${String(index)}].type is required`);
        }
        if (provider.model === undefined || provider.model === '') {
          errors.push(`providers[${String(index)}].model is required`);
        }
        if (
          provider.temperature !== undefined &&
          (provider.temperature < 0 || provider.temperature > 1)
        ) {
          errors.push(
            `providers[${String(index)}].temperature must be between 0 and 1`
          );
        }
      });
    }
  }

  // Validate ignore patterns
  if (config.ignorePatterns) {
    if (!Array.isArray(config.ignorePatterns)) {
      errors.push('ignorePatterns must be an array');
    } else {
      config.ignorePatterns.forEach((pattern, index) => {
        if (typeof pattern !== 'string') {
          errors.push(`ignorePatterns[${String(index)}] must be a string`);
        }
      });
    }
  }

  // Validate commands
  if (config.commands) {
    const validCommands = ['test', 'lint', 'build', 'typecheck'];
    for (const [key, value] of Object.entries(config.commands)) {
      if (!validCommands.includes(key)) {
        errors.push(`commands.${key} is not a valid command key`);
      }
      if (typeof value !== 'string') {
        errors.push(`commands.${key} must be a string`);
      }
    }
  }

  // Validate project settings
  if (config.project) {
    if (
      config.project.type &&
      !['node', 'browser', 'fullstack', 'library'].includes(config.project.type)
    ) {
      errors.push(
        'project.type must be "node", "browser", "fullstack", or "library"'
      );
    }
    if (
      config.project.language &&
      !['typescript', 'javascript'].includes(config.project.language)
    ) {
      errors.push('project.language must be "typescript" or "javascript"');
    }
  }

  return errors;
}

/**
 * Load and validate configuration from a repository.
 *
 * @param repoPath - Path to the repository
 * @returns Configuration load result
 * @throws ConfigValidationError if validation fails
 */
export async function loadConfig(repoPath: string): Promise<ConfigLoadResult> {
  const warnings: string[] = [];

  // Find config file
  const configPath = await findConfigFile(repoPath);

  if (configPath === undefined || configPath === '') {
    // Return default configuration if no file found
    warnings.push(
      'No configuration file found, using defaults. ' +
        'Create sloppy.config.json to customize behavior.'
    );

    return {
      config: {},
      filePath: '',
      warnings,
    };
  }

  // Load config based on file extension
  let config: SloppyConfig;
  if (configPath.endsWith('.json') || configPath.endsWith('.sloppyrc')) {
    config = await loadJsonConfig(configPath);
  } else if (configPath.endsWith('.js') || configPath.endsWith('.mjs')) {
    config = await loadJsConfig(configPath);
  } else {
    // Try JSON first, then JS
    try {
      config = await loadJsonConfig(configPath);
    } catch {
      config = await loadJsConfig(configPath);
    }
  }

  // Validate configuration
  const errors = validateConfig(config);
  if (errors.length > 0) {
    throw new ConfigValidationError(
      `Invalid configuration in ${configPath}`,
      errors
    );
  }

  // Check for deprecated options
  if ('strictLevel' in config) {
    warnings.push(
      'Configuration option "strictLevel" is deprecated. Use "session.strictness" instead.'
    );
  }

  return {
    config,
    filePath: configPath,
    warnings,
  };
}

/**
 * Merge loaded config with defaults.
 *
 * @param loaded - Loaded configuration
 * @param defaults - Default configuration
 * @returns Merged configuration
 */
export function mergeWithDefaults(
  loaded: SloppyConfig,
  defaults: SloppyConfig
): SloppyConfig {
  const result: SloppyConfig = {
    ...defaults,
    ...loaded,
    session: {
      ...defaults.session,
      ...loaded.session,
      ignorePatterns: [
        ...(defaults.session?.ignorePatterns ?? []),
        ...(loaded.session?.ignorePatterns ?? []),
      ],
    },
    ignorePatterns: [
      ...(defaults.ignorePatterns ?? []),
      ...(loaded.ignorePatterns ?? []),
    ],
    commands: {
      ...defaults.commands,
      ...loaded.commands,
    },
    project: {
      ...defaults.project,
      ...loaded.project,
    },
    rules: {
      ...defaults.rules,
      ...loaded.rules,
    },
  };

  // Handle providers separately due to exactOptionalPropertyTypes
  const providers = loaded.providers ?? defaults.providers;
  if (providers) {
    result.providers = providers;
  }

  return result;
}

/**
 * Get a provider config by ID or type.
 *
 * @param config - Sloppy configuration
 * @param idOrType - Provider ID or type
 * @returns Provider configuration or undefined
 */
export function getProvider(
  config: SloppyConfig,
  idOrType: string
): Partial<ProviderConfig> | undefined {
  if (!config.providers) {
    return undefined;
  }

  // Try to find by ID first
  let provider = config.providers.find((p) => p.id === idOrType);

  // If not found, try by type
  provider ??= config.providers.find((p) => p.type === (idOrType as ProviderType));

  return provider;
}

/**
 * Get the default provider from configuration.
 *
 * @param config - Sloppy configuration
 * @returns Default provider configuration or undefined
 */
export function getDefaultProvider(
  config: SloppyConfig
): Partial<ProviderConfig> | undefined {
  if (!config.providers || config.providers.length === 0) {
    return undefined;
  }

  // If defaultProvider is specified, use that
  if (config.defaultProvider !== undefined && config.defaultProvider !== '') {
    return getProvider(config, config.defaultProvider);
  }

  // Otherwise return the first enabled provider
  return config.providers.find((p) => p.enabled !== false);
}

/**
 * Create a sample configuration file content.
 *
 * @returns Sample config JSON string
 */
export function createSampleConfig(): string {
  const sample: SloppyConfig = {
    version: 1,
    session: {
      strictness: 'medium',
      ignorePatterns: ['**/node_modules/**', '**/dist/**', '**/*.test.ts'],
      autoCommit: true,
      commitPrefix: 'fix(sloppy):',
      maxAttemptsPerIssue: 3,
    },
    providers: [
      {
        id: 'claude-default',
        type: 'CLAUDE' as ProviderType,
        name: 'Claude Sonnet',
        model: 'claude-sonnet-4-20250514',
        maxTokens: 4096,
        temperature: 0.7,
      },
    ],
    defaultProvider: 'claude-default',
    commands: {
      test: 'npm test',
      lint: 'npm run lint',
      build: 'npm run build',
      typecheck: 'npm run typecheck',
    },
    project: {
      type: 'node',
      language: 'typescript',
    },
  };

  return JSON.stringify(sample, null, 2);
}
