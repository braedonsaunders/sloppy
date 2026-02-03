/**
 * @sloppy/providers - AI Provider adapters for Sloppy code quality improvement tool
 *
 * This package provides a unified interface for multiple AI providers:
 * - Claude (Anthropic API)
 * - OpenAI (GPT-4, GPT-4 Turbo)
 * - Ollama (Local models like CodeLlama, DeepSeek Coder)
 * - Claude Code CLI
 * - Codex CLI
 *
 * @example
 * ```typescript
 * import { createProvider, ClaudeProvider, autoDetectProvider } from '@sloppy/providers';
 *
 * // Create a specific provider
 * const claude = createProvider({
 *   type: 'claude',
 *   model: 'claude-sonnet-4-20250514',
 * });
 *
 * // Or auto-detect the best available provider
 * const provider = await autoDetectProvider();
 *
 * // Analyze code
 * const analysis = await provider.analyzeCode(['src/index.ts'], 'TypeScript project');
 *
 * // Fix an issue
 * const fix = await provider.fixIssue(analysis.issues[0], fileContent);
 *
 * // Verify the fix
 * const verification = await provider.verifyFix(issue, fix.diff, fileContent);
 * ```
 *
 * @packageDocumentation
 */

// ============================================================================
// Base Types and Classes
// ============================================================================

export {
  // Types
  type Issue,
  type IssueLocation,
  type IssueSeverity,
  type IssueCategory,
  type AnalysisResult,
  type FixResult,
  type VerifyResult,
  type ProviderConfig as BaseProviderConfig,
  type StreamCallbacks,
  type RetryOptions,

  // Schemas (for validation)
  IssueSchema,
  IssueLocationSchema,
  IssueSeveritySchema,
  IssueCategorySchema,
  AnalysisResultSchema,
  FixResultSchema,
  VerifyResultSchema,

  // Base class
  BaseProvider,

  // Errors
  ProviderError,
  RateLimitError,
  AuthenticationError,
  TimeoutError,
  InvalidResponseError,

  // Utilities
  RateLimiter,
  withRetry,
} from './base.js';

// ============================================================================
// Providers
// ============================================================================

// Claude Provider
export {
  ClaudeProvider,
  type ClaudeProviderConfig,
  type ClaudeModel,
} from './claude/index.js';

// OpenAI Provider
export {
  OpenAIProvider,
  type OpenAIProviderConfig,
  type OpenAIModel,
} from './openai/index.js';

// Ollama Provider
export {
  OllamaProvider,
  type OllamaProviderConfig,
  type OllamaModel,
} from './ollama/index.js';

// Claude Code CLI Provider
export {
  ClaudeCodeCLIProvider,
  type ClaudeCodeCLIConfig,
} from './cli/claude-code.js';

// Codex CLI Provider
export {
  CodexCLIProvider,
  type CodexCLIConfig,
  type CodexModel,
} from './cli/codex.js';

// ============================================================================
// Factory
// ============================================================================

export {
  createProvider,
  createClaudeProvider,
  createOpenAIProvider,
  createOllamaProvider,
  createClaudeCodeCLIProvider,
  createCodexCLIProvider,
  autoDetectProvider,
  registerProvider,
  getRegisteredProvider,
  listRegisteredProviders,
  type ProviderType,
  type ProviderConfig,
  ProviderConfigSchema,
} from './factory.js';

// ============================================================================
// Prompts (for customization)
// ============================================================================

export {
  // Analysis prompts
  ANALYSIS_SYSTEM_PROMPT,
  ANALYSIS_TYPE_INSTRUCTIONS,
  generateAnalysisUserPrompt,
  parseAnalysisResponse,
  detectLanguage,
  type AnalysisType,
  type AnalysisPromptOptions,
} from './prompts/analysis.js';

export {
  // Fix prompts
  FIX_SYSTEM_PROMPT,
  FIX_TYPE_INSTRUCTIONS,
  DIFF_GENERATION_INSTRUCTIONS,
  generateFixUserPrompt,
  parseFixResponse,
  type FixPromptOptions,
} from './prompts/fix.js';

export {
  // Verify prompts
  VERIFY_SYSTEM_PROMPT,
  generateVerifyUserPrompt,
  generateQuickVerifyPrompt,
  parseVerifyResponse,
  type VerifyPromptOptions,
} from './prompts/verify.js';

// ============================================================================
// Default Export
// ============================================================================

export { createProvider as default } from './factory.js';
