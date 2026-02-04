/**
 * Provider Types and Interfaces
 *
 * Defines the structure for AI provider configurations and results.
 * Providers are the AI models/services that analyze code and suggest fixes.
 */

import type { Issue } from './issue.js';

/**
 * Supported AI provider types.
 */
export enum ProviderType {
  /** Anthropic Claude API */
  CLAUDE = 'CLAUDE',

  /** OpenAI GPT API */
  OPENAI = 'OPENAI',

  /** Local Ollama instance */
  OLLAMA = 'OLLAMA',

  /** Claude Code CLI (local agent) */
  CLAUDE_CODE_CLI = 'CLAUDE_CODE_CLI',

  /** OpenAI Codex CLI */
  CODEX_CLI = 'CODEX_CLI',

  /** Google Gemini API */
  GEMINI = 'GEMINI',

  /** OpenRouter (multi-provider aggregator) */
  OPENROUTER = 'OPENROUTER',

  /** DeepSeek API */
  DEEPSEEK = 'DEEPSEEK',

  /** Mistral AI API */
  MISTRAL = 'MISTRAL',

  /** Groq (fast inference) */
  GROQ = 'GROQ',

  /** Together AI */
  TOGETHER = 'TOGETHER',

  /** Cohere API */
  COHERE = 'COHERE',
}

/**
 * Configuration for an AI provider.
 */
export interface ProviderConfig {
  /**
   * Unique identifier for this configuration.
   * Format: UUID v4
   */
  id: string;

  /**
   * Type of provider.
   */
  type: ProviderType;

  /**
   * Display name for this configuration.
   */
  name: string;

  /**
   * API key for authentication.
   * Required for CLAUDE and OPENAI providers.
   */
  apiKey?: string;

  /**
   * Base URL for the API.
   * Required for OLLAMA, optional for others (to use custom endpoints).
   */
  baseUrl?: string;

  /**
   * Model identifier to use.
   * @example 'claude-sonnet-4-20250514' for Claude, 'gpt-4' for OpenAI
   */
  model: string;

  /**
   * Maximum tokens for responses.
   * @default 4096
   */
  maxTokens?: number;

  /**
   * Temperature for response generation (0-1).
   * @default 0.7
   */
  temperature?: number;

  /**
   * Request timeout in milliseconds.
   * @default 60000
   */
  timeoutMs?: number;

  /**
   * Maximum retries for failed requests.
   * @default 3
   */
  maxRetries?: number;

  /**
   * Whether this provider is enabled.
   * @default true
   */
  enabled?: boolean;

  /**
   * Custom headers to include in requests.
   */
  customHeaders?: Record<string, string>;

  /**
   * Cost per 1K input tokens (for tracking).
   */
  costPerInputToken?: number;

  /**
   * Cost per 1K output tokens (for tracking).
   */
  costPerOutputToken?: number;

  /**
   * Path to CLI executable (for CLI-based providers).
   */
  cliPath?: string;

  /**
   * Additional CLI arguments.
   */
  cliArgs?: string[];
}

/**
 * Result of analyzing code for issues.
 */
export interface AnalysisResult {
  /**
   * Array of issues found during analysis.
   */
  issues: Issue[];

  /**
   * Total tokens used for analysis.
   */
  tokensUsed?: number;

  /**
   * Time taken for analysis in milliseconds.
   */
  durationMs?: number;

  /**
   * Raw response from the provider (for debugging).
   */
  rawResponse?: string;

  /**
   * Any warnings generated during analysis.
   */
  warnings?: string[];

  /**
   * Files that were analyzed.
   */
  filesAnalyzed?: string[];

  /**
   * Files that were skipped (e.g., due to size limits).
   */
  filesSkipped?: string[];
}

/**
 * Result of attempting to fix an issue.
 */
export interface FixResult {
  /**
   * Whether the fix was successful.
   */
  success: boolean;

  /**
   * Diff content showing the changes made.
   * Undefined if fix failed.
   */
  diff?: string;

  /**
   * Error message if fix failed.
   */
  error?: string;

  /**
   * Total tokens used for the fix.
   */
  tokensUsed?: number;

  /**
   * Time taken for the fix in milliseconds.
   */
  durationMs?: number;

  /**
   * Files that were modified.
   */
  filesModified?: string[];

  /**
   * Explanation of the fix (from the AI).
   */
  explanation?: string;

  /**
   * Confidence score (0-1) if provided by the model.
   */
  confidence?: number;

  /**
   * Alternative fixes suggested (if any).
   */
  alternatives?: string[];
}

/**
 * Result of verifying a fix.
 */
export interface VerifyResult {
  /**
   * Whether the fix is valid and passes all checks.
   */
  valid: boolean;

  /**
   * Array of error messages if validation failed.
   */
  errors: string[];

  /**
   * Warnings that don't fail validation.
   */
  warnings?: string[];

  /**
   * Test results if tests were run.
   */
  testResults?: {
    passed: number;
    failed: number;
    skipped: number;
    duration: number;
  };

  /**
   * Lint results if linting was run.
   */
  lintResults?: {
    errors: number;
    warnings: number;
  };

  /**
   * Type check results if type checking was run.
   */
  typeCheckResults?: {
    errors: number;
  };

  /**
   * Build results if build was run.
   */
  buildResults?: {
    success: boolean;
    duration: number;
  };
}

/**
 * Interface that all providers must implement.
 */
export interface Provider {
  /**
   * Provider configuration.
   */
  readonly config: ProviderConfig;

  /**
   * Initialize the provider.
   */
  initialize(): Promise<void>;

  /**
   * Analyze code for issues.
   *
   * @param files - Files to analyze (path -> content map)
   * @param context - Additional context for analysis
   * @returns Analysis result with found issues
   */
  analyze(
    files: Map<string, string>,
    context?: AnalysisContext
  ): Promise<AnalysisResult>;

  /**
   * Generate a fix for an issue.
   *
   * @param issue - Issue to fix
   * @param fileContent - Current content of the file
   * @param context - Additional context for fixing
   * @returns Fix result with diff if successful
   */
  fix(
    issue: Issue,
    fileContent: string,
    context?: FixContext
  ): Promise<FixResult>;

  /**
   * Verify that a fix is valid.
   *
   * @param issue - Original issue
   * @param diff - Applied diff
   * @param context - Additional context for verification
   * @returns Verification result
   */
  verify(
    issue: Issue,
    diff: string,
    context?: VerifyContext
  ): Promise<VerifyResult>;

  /**
   * Clean up resources.
   */
  dispose(): Promise<void>;
}

/**
 * Context for code analysis.
 */
export interface AnalysisContext {
  /**
   * Repository root path.
   */
  repoPath: string;

  /**
   * Strictness level for analysis.
   */
  strictness: 'low' | 'medium' | 'high';

  /**
   * Issue types to look for.
   */
  issueTypes?: string[];

  /**
   * Custom instructions for the AI.
   */
  customPrompt?: string;

  /**
   * Project configuration (package.json, tsconfig, etc.).
   */
  projectConfig?: Record<string, unknown>;
}

/**
 * Context for fixing an issue.
 */
export interface FixContext {
  /**
   * Repository root path.
   */
  repoPath: string;

  /**
   * Previous fix attempts for this issue.
   */
  previousAttempts?: FixResult[];

  /**
   * Related files that might be helpful.
   */
  relatedFiles?: Map<string, string>;

  /**
   * Custom instructions for the AI.
   */
  customPrompt?: string;

  /**
   * Test output if tests failed.
   */
  testOutput?: string;

  /**
   * Lint output if linting failed.
   */
  lintOutput?: string;

  /**
   * Build output if build failed.
   */
  buildOutput?: string;
}

/**
 * Context for verifying a fix.
 */
export interface VerifyContext {
  /**
   * Repository root path.
   */
  repoPath: string;

  /**
   * Command to run tests.
   */
  testCommand?: string;

  /**
   * Command to run linter.
   */
  lintCommand?: string;

  /**
   * Command to run build.
   */
  buildCommand?: string;

  /**
   * Timeout for verification commands.
   */
  timeoutMs?: number;
}

/**
 * Default provider configuration values.
 */
export const DEFAULT_PROVIDER_CONFIG: Partial<ProviderConfig> = {
  maxTokens: 4096,
  temperature: 0.7,
  timeoutMs: 60000,
  maxRetries: 3,
  enabled: true,
};

/**
 * Recommended models for each provider type.
 */
export const RECOMMENDED_MODELS: Record<ProviderType, string[]> = {
  [ProviderType.CLAUDE]: [
    'claude-sonnet-4-20250514',
    'claude-opus-4-20250514',
    'claude-3-5-sonnet-20241022',
    'claude-3-5-haiku-20241022',
  ],
  [ProviderType.OPENAI]: ['gpt-4o', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo'],
  [ProviderType.OLLAMA]: [
    'codellama:70b',
    'codellama:34b',
    'deepseek-coder:33b',
    'phind-codellama:34b',
  ],
  [ProviderType.CLAUDE_CODE_CLI]: ['default'],
  [ProviderType.CODEX_CLI]: ['default'],
  [ProviderType.GEMINI]: [
    'gemini-2.0-flash',
    'gemini-1.5-pro',
    'gemini-1.5-flash',
    'gemini-1.0-pro',
  ],
  [ProviderType.OPENROUTER]: [
    'anthropic/claude-3.5-sonnet',
    'openai/gpt-4o',
    'google/gemini-pro-1.5',
    'meta-llama/llama-3.1-70b-instruct',
  ],
  [ProviderType.DEEPSEEK]: [
    'deepseek-chat',
    'deepseek-coder',
    'deepseek-reasoner',
  ],
  [ProviderType.MISTRAL]: [
    'mistral-large-latest',
    'mistral-medium-latest',
    'mistral-small-latest',
    'codestral-latest',
  ],
  [ProviderType.GROQ]: [
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
    'mixtral-8x7b-32768',
    'gemma2-9b-it',
  ],
  [ProviderType.TOGETHER]: [
    'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo',
    'mistralai/Mixtral-8x22B-Instruct-v0.1',
    'Qwen/Qwen2.5-72B-Instruct-Turbo',
  ],
  [ProviderType.COHERE]: [
    'command-r-plus',
    'command-r',
    'command-light',
  ],
};

/**
 * Validate a provider configuration.
 *
 * @param config - Configuration to validate
 * @returns Array of validation errors (empty if valid)
 */
export function validateProviderConfig(
  config: Partial<ProviderConfig>
): string[] {
  const errors: string[] = [];

  if (!config.type) {
    errors.push('Provider type is required');
  }

  if (!config.model) {
    errors.push('Model is required');
  }

  // Providers that require API keys
  const apiKeyRequiredProviders = [
    ProviderType.CLAUDE,
    ProviderType.OPENAI,
    ProviderType.GEMINI,
    ProviderType.OPENROUTER,
    ProviderType.DEEPSEEK,
    ProviderType.MISTRAL,
    ProviderType.GROQ,
    ProviderType.TOGETHER,
    ProviderType.COHERE,
  ];

  if (apiKeyRequiredProviders.includes(config.type as ProviderType)) {
    if (!config.apiKey) {
      errors.push(`API key is required for ${config.type} provider`);
    }
  }

  if (config.type === ProviderType.OLLAMA) {
    if (!config.baseUrl) {
      errors.push('Base URL is required for Ollama provider');
    }
  }

  if (
    config.type === ProviderType.CLAUDE_CODE_CLI ||
    config.type === ProviderType.CODEX_CLI
  ) {
    // CLI providers may need cliPath validation
  }

  if (
    config.temperature !== undefined &&
    (config.temperature < 0 || config.temperature > 1)
  ) {
    errors.push('Temperature must be between 0 and 1');
  }

  if (
    config.maxTokens !== undefined &&
    (config.maxTokens < 1 || config.maxTokens > 100000)
  ) {
    errors.push('Max tokens must be between 1 and 100000');
  }

  return errors;
}
