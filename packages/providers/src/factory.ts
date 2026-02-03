import { z } from 'zod';
import { BaseProvider, ProviderError } from './base.js';
import { ClaudeProvider, ClaudeProviderConfig, ClaudeModel } from './claude/index.js';
import { OpenAIProvider, OpenAIProviderConfig, OpenAIModel } from './openai/index.js';
import { OllamaProvider, OllamaProviderConfig, OllamaModel } from './ollama/index.js';
import { ClaudeCodeCLIProvider, ClaudeCodeCLIConfig } from './cli/claude-code.js';
import { CodexCLIProvider, CodexCLIConfig, CodexModel } from './cli/codex.js';
import { AnalysisType } from './prompts/analysis.js';

// ============================================================================
// Provider Types
// ============================================================================

export type ProviderType =
  | 'claude'
  | 'openai'
  | 'ollama'
  | 'claude-cli'
  | 'codex-cli';

// ============================================================================
// Configuration Schema
// ============================================================================

const BaseConfigSchema = z.object({
  maxTokens: z.number().optional(),
  temperature: z.number().min(0).max(2).optional(),
  timeout: z.number().optional(),
  maxRetries: z.number().optional(),
  rateLimitRpm: z.number().optional(),
  rateLimitTpm: z.number().optional(),
  analysisType: z.enum(['full', 'security', 'performance', 'maintainability', 'bugs', 'style', 'quick']).optional(),
});

const ClaudeConfigSchema = BaseConfigSchema.extend({
  type: z.literal('claude'),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  model: z.enum([
    'claude-sonnet-4-20250514',
    'claude-opus-4-20250514',
    'claude-3-5-sonnet-20241022',
    'claude-3-5-haiku-20241022',
  ]).optional(),
});

const OpenAIConfigSchema = BaseConfigSchema.extend({
  type: z.literal('openai'),
  apiKey: z.string().optional(),
  organization: z.string().optional(),
  baseUrl: z.string().optional(),
  model: z.enum([
    'gpt-4o',
    'gpt-4o-mini',
    'gpt-4-turbo',
    'gpt-4-turbo-preview',
    'gpt-4',
    'gpt-3.5-turbo',
  ]).optional(),
});

const OllamaConfigSchema = BaseConfigSchema.extend({
  type: z.literal('ollama'),
  baseUrl: z.string().optional(),
  model: z.string().optional(),
  keepAlive: z.string().optional(),
  numCtx: z.number().optional(),
  numGpu: z.number().optional(),
});

const ClaudeCLIConfigSchema = BaseConfigSchema.extend({
  type: z.literal('claude-cli'),
  cliPath: z.string().optional(),
  workingDirectory: z.string().optional(),
  allowedTools: z.array(z.string()).optional(),
  disallowedTools: z.array(z.string()).optional(),
  maxTurns: z.number().optional(),
  outputFormat: z.enum(['text', 'json', 'stream-json']).optional(),
});

const CodexCLIConfigSchema = BaseConfigSchema.extend({
  type: z.literal('codex-cli'),
  cliPath: z.string().optional(),
  model: z.string().optional(),
  workingDirectory: z.string().optional(),
  approvalMode: z.enum(['suggest', 'auto-edit', 'full-auto']).optional(),
  quietMode: z.boolean().optional(),
});

export const ProviderConfigSchema = z.discriminatedUnion('type', [
  ClaudeConfigSchema,
  OpenAIConfigSchema,
  OllamaConfigSchema,
  ClaudeCLIConfigSchema,
  CodexCLIConfigSchema,
]);

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a provider instance based on configuration
 *
 * @param config - Provider configuration with type discriminator
 * @returns Configured provider instance
 *
 * @example
 * ```typescript
 * // Create a Claude provider
 * const claude = createProvider({
 *   type: 'claude',
 *   model: 'claude-sonnet-4-20250514',
 *   apiKey: process.env.ANTHROPIC_API_KEY,
 * });
 *
 * // Create an OpenAI provider
 * const openai = createProvider({
 *   type: 'openai',
 *   model: 'gpt-4o',
 * });
 *
 * // Create an Ollama provider for local models
 * const ollama = createProvider({
 *   type: 'ollama',
 *   model: 'codellama',
 *   baseUrl: 'http://localhost:11434',
 * });
 *
 * // Create a Claude CLI provider
 * const claudeCli = createProvider({
 *   type: 'claude-cli',
 *   workingDirectory: '/path/to/project',
 * });
 *
 * // Create a Codex CLI provider
 * const codex = createProvider({
 *   type: 'codex-cli',
 *   approvalMode: 'auto-edit',
 * });
 * ```
 */
export function createProvider(config: ProviderConfig): BaseProvider {
  // Validate configuration
  const validated = ProviderConfigSchema.parse(config);

  // Helper to create clean config objects by spreading only defined values
  // Using type assertion as we know the shape is correct after validation
  switch (validated.type) {
    case 'claude': {
      const claudeConfig: ClaudeProviderConfig = {};
      if (validated.apiKey !== undefined) claudeConfig.apiKey = validated.apiKey;
      if (validated.baseUrl !== undefined) claudeConfig.baseUrl = validated.baseUrl;
      if (validated.model !== undefined) claudeConfig.model = validated.model;
      if (validated.maxTokens !== undefined) claudeConfig.maxTokens = validated.maxTokens;
      if (validated.temperature !== undefined) claudeConfig.temperature = validated.temperature;
      if (validated.timeout !== undefined) claudeConfig.timeout = validated.timeout;
      if (validated.maxRetries !== undefined) claudeConfig.maxRetries = validated.maxRetries;
      if (validated.rateLimitRpm !== undefined) claudeConfig.rateLimitRpm = validated.rateLimitRpm;
      if (validated.rateLimitTpm !== undefined) claudeConfig.rateLimitTpm = validated.rateLimitTpm;
      if (validated.analysisType !== undefined) claudeConfig.analysisType = validated.analysisType;
      return new ClaudeProvider(claudeConfig);
    }

    case 'openai': {
      const openaiConfig: OpenAIProviderConfig = {};
      if (validated.apiKey !== undefined) openaiConfig.apiKey = validated.apiKey;
      if (validated.organization !== undefined) openaiConfig.organization = validated.organization;
      if (validated.baseUrl !== undefined) openaiConfig.baseUrl = validated.baseUrl;
      if (validated.model !== undefined) openaiConfig.model = validated.model;
      if (validated.maxTokens !== undefined) openaiConfig.maxTokens = validated.maxTokens;
      if (validated.temperature !== undefined) openaiConfig.temperature = validated.temperature;
      if (validated.timeout !== undefined) openaiConfig.timeout = validated.timeout;
      if (validated.maxRetries !== undefined) openaiConfig.maxRetries = validated.maxRetries;
      if (validated.rateLimitRpm !== undefined) openaiConfig.rateLimitRpm = validated.rateLimitRpm;
      if (validated.rateLimitTpm !== undefined) openaiConfig.rateLimitTpm = validated.rateLimitTpm;
      if (validated.analysisType !== undefined) openaiConfig.analysisType = validated.analysisType;
      return new OpenAIProvider(openaiConfig);
    }

    case 'ollama': {
      const ollamaConfig: OllamaProviderConfig = {};
      if (validated.baseUrl !== undefined) ollamaConfig.baseUrl = validated.baseUrl;
      if (validated.model !== undefined) ollamaConfig.model = validated.model;
      if (validated.maxTokens !== undefined) ollamaConfig.maxTokens = validated.maxTokens;
      if (validated.temperature !== undefined) ollamaConfig.temperature = validated.temperature;
      if (validated.timeout !== undefined) ollamaConfig.timeout = validated.timeout;
      if (validated.maxRetries !== undefined) ollamaConfig.maxRetries = validated.maxRetries;
      if (validated.rateLimitRpm !== undefined) ollamaConfig.rateLimitRpm = validated.rateLimitRpm;
      if (validated.rateLimitTpm !== undefined) ollamaConfig.rateLimitTpm = validated.rateLimitTpm;
      if (validated.analysisType !== undefined) ollamaConfig.analysisType = validated.analysisType;
      if (validated.keepAlive !== undefined) ollamaConfig.keepAlive = validated.keepAlive;
      if (validated.numCtx !== undefined) ollamaConfig.numCtx = validated.numCtx;
      if (validated.numGpu !== undefined) ollamaConfig.numGpu = validated.numGpu;
      return new OllamaProvider(ollamaConfig);
    }

    case 'claude-cli': {
      const cliConfig: ClaudeCodeCLIConfig = {};
      if (validated.cliPath !== undefined) cliConfig.cliPath = validated.cliPath;
      if (validated.maxTokens !== undefined) cliConfig.maxTokens = validated.maxTokens;
      if (validated.temperature !== undefined) cliConfig.temperature = validated.temperature;
      if (validated.timeout !== undefined) cliConfig.timeout = validated.timeout;
      if (validated.maxRetries !== undefined) cliConfig.maxRetries = validated.maxRetries;
      if (validated.rateLimitRpm !== undefined) cliConfig.rateLimitRpm = validated.rateLimitRpm;
      if (validated.rateLimitTpm !== undefined) cliConfig.rateLimitTpm = validated.rateLimitTpm;
      if (validated.analysisType !== undefined) cliConfig.analysisType = validated.analysisType;
      if (validated.workingDirectory !== undefined) cliConfig.workingDirectory = validated.workingDirectory;
      if (validated.allowedTools !== undefined) cliConfig.allowedTools = validated.allowedTools;
      if (validated.disallowedTools !== undefined) cliConfig.disallowedTools = validated.disallowedTools;
      if (validated.maxTurns !== undefined) cliConfig.maxTurns = validated.maxTurns;
      if (validated.outputFormat !== undefined) cliConfig.outputFormat = validated.outputFormat;
      return new ClaudeCodeCLIProvider(cliConfig);
    }

    case 'codex-cli': {
      const codexConfig: CodexCLIConfig = {};
      if (validated.cliPath !== undefined) codexConfig.cliPath = validated.cliPath;
      if (validated.model !== undefined) codexConfig.model = validated.model;
      if (validated.maxTokens !== undefined) codexConfig.maxTokens = validated.maxTokens;
      if (validated.temperature !== undefined) codexConfig.temperature = validated.temperature;
      if (validated.timeout !== undefined) codexConfig.timeout = validated.timeout;
      if (validated.maxRetries !== undefined) codexConfig.maxRetries = validated.maxRetries;
      if (validated.rateLimitRpm !== undefined) codexConfig.rateLimitRpm = validated.rateLimitRpm;
      if (validated.rateLimitTpm !== undefined) codexConfig.rateLimitTpm = validated.rateLimitTpm;
      if (validated.analysisType !== undefined) codexConfig.analysisType = validated.analysisType;
      if (validated.workingDirectory !== undefined) codexConfig.workingDirectory = validated.workingDirectory;
      if (validated.approvalMode !== undefined) codexConfig.approvalMode = validated.approvalMode;
      if (validated.quietMode !== undefined) codexConfig.quietMode = validated.quietMode;
      return new CodexCLIProvider(codexConfig);
    }

    default:
      throw new ProviderError(
        `Unknown provider type: ${(validated as { type: string }).type}`,
        'UNKNOWN_PROVIDER',
        false,
      );
  }
}

// ============================================================================
// Convenience Factory Functions
// ============================================================================

/**
 * Create a Claude provider with minimal configuration
 */
export function createClaudeProvider(
  options: Omit<z.infer<typeof ClaudeConfigSchema>, 'type'> = {},
): ClaudeProvider {
  return createProvider({ type: 'claude', ...options }) as ClaudeProvider;
}

/**
 * Create an OpenAI provider with minimal configuration
 */
export function createOpenAIProvider(
  options: Omit<z.infer<typeof OpenAIConfigSchema>, 'type'> = {},
): OpenAIProvider {
  return createProvider({ type: 'openai', ...options }) as OpenAIProvider;
}

/**
 * Create an Ollama provider with minimal configuration
 */
export function createOllamaProvider(
  options: Omit<z.infer<typeof OllamaConfigSchema>, 'type'> = {},
): OllamaProvider {
  return createProvider({ type: 'ollama', ...options }) as OllamaProvider;
}

/**
 * Create a Claude CLI provider with minimal configuration
 */
export function createClaudeCodeCLIProvider(
  options: Omit<z.infer<typeof ClaudeCLIConfigSchema>, 'type'> = {},
): ClaudeCodeCLIProvider {
  return createProvider({ type: 'claude-cli', ...options }) as ClaudeCodeCLIProvider;
}

/**
 * Create a Codex CLI provider with minimal configuration
 */
export function createCodexCLIProvider(
  options: Omit<z.infer<typeof CodexCLIConfigSchema>, 'type'> = {},
): CodexCLIProvider {
  return createProvider({ type: 'codex-cli', ...options }) as CodexCLIProvider;
}

// ============================================================================
// Auto-Detection
// ============================================================================

/**
 * Automatically detect and create the best available provider
 *
 * Priority:
 * 1. Claude (if ANTHROPIC_API_KEY is set)
 * 2. OpenAI (if OPENAI_API_KEY is set)
 * 3. Ollama (if server is running locally)
 * 4. Claude CLI (if 'claude' command is available)
 * 5. Codex CLI (if 'codex' command is available)
 */
export async function autoDetectProvider(): Promise<BaseProvider> {
  // Check for Claude API key
  if (process.env['ANTHROPIC_API_KEY']) {
    return createClaudeProvider();
  }

  // Check for OpenAI API key
  if (process.env['OPENAI_API_KEY']) {
    return createOpenAIProvider();
  }

  // Check for local Ollama server
  try {
    const ollamaProvider = createOllamaProvider();
    const health = await ollamaProvider.healthCheck();
    if (health.healthy && health.models.length > 0) {
      return ollamaProvider;
    }
  } catch {
    // Ollama not available
  }

  // Check for Claude CLI
  try {
    const claudeCli = createClaudeCodeCLIProvider();
    const health = await claudeCli.healthCheck();
    if (health.available) {
      return claudeCli;
    }
  } catch {
    // Claude CLI not available
  }

  // Check for Codex CLI
  try {
    const codexCli = createCodexCLIProvider();
    const health = await codexCli.healthCheck();
    if (health.available) {
      return codexCli;
    }
  } catch {
    // Codex CLI not available
  }

  throw new ProviderError(
    'No AI provider available. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, run Ollama locally, or install Claude/Codex CLI.',
    'NO_PROVIDER_AVAILABLE',
    false,
  );
}

// ============================================================================
// Provider Registry
// ============================================================================

const providerRegistry = new Map<string, () => BaseProvider>();

/**
 * Register a custom provider factory
 */
export function registerProvider(
  name: string,
  factory: () => BaseProvider,
): void {
  providerRegistry.set(name, factory);
}

/**
 * Get a registered provider by name
 */
export function getRegisteredProvider(name: string): BaseProvider | undefined {
  const factory = providerRegistry.get(name);
  return factory?.();
}

/**
 * List all registered provider names
 */
export function listRegisteredProviders(): string[] {
  return Array.from(providerRegistry.keys());
}
