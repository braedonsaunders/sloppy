/**
 * LLM Analyzer
 *
 * An agentic code analyzer that uses LLMs to detect issues
 * beyond what static analyzers can find. The LLM orchestrates
 * the entire analysis process, including running other tools.
 *
 * Supports all providers from @sloppy/providers:
 * - Claude (Anthropic)
 * - OpenAI
 * - Ollama (local)
 * - Gemini (Google)
 * - OpenRouter
 * - DeepSeek
 * - Mistral
 * - Groq
 * - Together AI
 * - Cohere
 */

import {
  BaseAnalyzer,
  type Issue,
  type AnalyzerOptions,
  type IssueCategory,
} from '../base.js';
import { FileBrowser, type FileBrowserConfig } from './file-browser.js';
import { ToolExecutor, TOOL_DEFINITIONS } from './tool-executor.js';
import {
  LLM_ANALYSIS_SYSTEM_PROMPT,
  generateAnalysisPrompt,
  mapToIssueCategory,
  mapToSeverity,
} from './prompts.js';

/**
 * Supported provider types (matching @sloppy/providers)
 */
export type LLMProviderType =
  | 'claude'
  | 'openai'
  | 'ollama'
  | 'gemini'
  | 'openrouter'
  | 'deepseek'
  | 'mistral'
  | 'groq'
  | 'together'
  | 'cohere';

/**
 * Provider-specific base URLs
 */
const PROVIDER_BASE_URLS: Record<LLMProviderType, string> = {
  claude: 'https://api.anthropic.com',
  openai: 'https://api.openai.com/v1',
  ollama: 'http://localhost:11434/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  openrouter: 'https://openrouter.ai/api/v1',
  deepseek: 'https://api.deepseek.com/v1',
  mistral: 'https://api.mistral.ai/v1',
  groq: 'https://api.groq.com/openai/v1',
  together: 'https://api.together.xyz/v1',
  cohere: 'https://api.cohere.ai/v1',
};

/**
 * Default models per provider
 */
const PROVIDER_DEFAULT_MODELS: Record<LLMProviderType, string> = {
  claude: 'claude-sonnet-4-20250514',
  openai: 'gpt-4o',
  ollama: 'llama3',
  gemini: 'gemini-2.0-flash',
  openrouter: 'anthropic/claude-3.5-sonnet',
  deepseek: 'deepseek-chat',
  mistral: 'mistral-large-latest',
  groq: 'llama-3.3-70b-versatile',
  together: 'meta-llama/Llama-3-70b-chat-hf',
  cohere: 'command-r-plus',
};

/**
 * Configuration for the LLM analyzer
 */
export interface LLMAnalyzerConfig {
  /** API key for the LLM provider */
  apiKey?: string;
  /** LLM model to use */
  model?: string;
  /** LLM provider type */
  provider?: LLMProviderType;
  /** Base URL for the LLM API (auto-detected from provider if not set) */
  baseUrl?: string;
  /** Maximum tokens for analysis response */
  maxTokens?: number;
  /** Temperature for generation (0-1) */
  temperature?: number;
  /** Maximum iterations for agentic analysis */
  maxIterations?: number;
  /** Maximum files to analyze per batch */
  batchSize?: number;
  /** Whether to run ESLint as part of analysis */
  runLint?: boolean;
  /** Whether to run TypeScript checking as part of analysis */
  runTypeCheck?: boolean;
  /** Whether to run tests as part of analysis */
  runTests?: boolean;
  /** Whether to run build as part of analysis */
  runBuild?: boolean;
  /** Timeout for tool execution (ms) */
  toolTimeout?: number;
  /** File browser configuration */
  fileBrowserConfig?: FileBrowserConfig;
  /** Custom system prompt override */
  systemPrompt?: string;
  /** Focus areas for analysis */
  focusAreas?: string[];
  /** Session ID for tracking (for learnings persistence) */
  sessionId?: string;
  /** Database path for learnings (optional, enables SQLite persistence) */
  databasePath?: string;
}

/**
 * Parsed LLM issue from response
 */
interface LLMIssue {
  type: string;
  severity: string;
  title: string;
  description: string;
  file: string;
  lineStart: number;
  lineEnd: number;
  suggestedFix?: string;
  confidence?: number;
}

/**
 * Parsed LLM response
 */
interface LLMResponse {
  issues: LLMIssue[];
  summary: string;
  filesAnalyzed: string[];
}

/**
 * Tool call from LLM
 */
interface ToolCall {
  name: string;
  parameters: Record<string, unknown>;
}

/**
 * Message in conversation
 */
interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

/**
 * Detect the API key based on provider type
 */
function detectApiKey(provider: LLMProviderType): string {
  const envKeys: Record<LLMProviderType, string[]> = {
    claude: ['ANTHROPIC_API_KEY'],
    openai: ['OPENAI_API_KEY'],
    ollama: [], // Ollama doesn't need an API key
    gemini: ['GOOGLE_API_KEY', 'GEMINI_API_KEY'],
    openrouter: ['OPENROUTER_API_KEY'],
    deepseek: ['DEEPSEEK_API_KEY'],
    mistral: ['MISTRAL_API_KEY'],
    groq: ['GROQ_API_KEY'],
    together: ['TOGETHER_API_KEY'],
    cohere: ['COHERE_API_KEY', 'CO_API_KEY'],
  };

  const keys = envKeys[provider];
  for (const key of keys) {
    const value = process.env[key];
    if (value !== undefined && value !== '') {return value;}
  }

  // Fallback to common keys
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  return anthropicKey !== undefined && anthropicKey !== '' ? anthropicKey : (openaiKey !== undefined && openaiKey !== '' ? openaiKey : '');
}

/**
 * LLM Analyzer - Agentic code analysis using LLMs
 *
 * Supports multiple providers through the @sloppy/providers configuration pattern.
 * All non-Claude providers use OpenAI-compatible APIs.
 */
export class LLMAnalyzer extends BaseAnalyzer {
  readonly name = 'llm-analyzer';
  readonly description = 'AI-powered deep code analysis for logic bugs, security issues, and code smells';
  readonly category: IssueCategory = 'llm';

  private readonly config: Required<LLMAnalyzerConfig>;
  private activeConfig: Required<LLMAnalyzerConfig> | null = null; // Config used during current analysis run
  private fileBrowser: FileBrowser | null = null;
  private toolExecutor: ToolExecutor | null = null;

  constructor(config: LLMAnalyzerConfig = {}) {
    super();

    // Detect provider from config or environment
    const provider = config.provider ?? 'claude';

    this.config = {
      apiKey: config.apiKey ?? detectApiKey(provider),
      model: config.model ?? PROVIDER_DEFAULT_MODELS[provider],
      provider,
      baseUrl: config.baseUrl ?? PROVIDER_BASE_URLS[provider],
      maxTokens: config.maxTokens ?? 8192,
      temperature: config.temperature ?? 0,
      maxIterations: config.maxIterations ?? 10,
      batchSize: config.batchSize ?? 5,
      runLint: config.runLint ?? true,
      runTypeCheck: config.runTypeCheck ?? true,
      runTests: config.runTests ?? false,
      runBuild: config.runBuild ?? false,
      toolTimeout: config.toolTimeout ?? 60000,
      fileBrowserConfig: config.fileBrowserConfig ?? {},
      systemPrompt: config.systemPrompt ?? '',
      focusAreas: config.focusAreas ?? [],
      sessionId: config.sessionId ?? '',
      databasePath: config.databasePath ?? '',
    };
  }

  /**
   * Get the effective provider type
   */
  get providerType(): LLMProviderType {
    return this.config.provider;
  }

  /**
   * Get the active config (runtime config during analysis, or default config)
   */
  private getConfig(): Required<LLMAnalyzerConfig> {
    return this.activeConfig ?? this.config;
  }

  /**
   * Analyze files using LLM-powered agentic analysis
   */
  async analyze(files: string[], options: AnalyzerOptions): Promise<Issue[]> {
    // Merge runtime config from options.config with constructor config
    // This allows the orchestrator to pass provider config at analysis time
    const runtimeConfig = options.config as Partial<LLMAnalyzerConfig> | undefined;

    // When the provider changes at runtime, update the baseUrl to match
    // unless an explicit baseUrl was provided in the runtime config
    const runtimeProvider = runtimeConfig?.provider;
    const providerChanged = runtimeProvider !== undefined && runtimeProvider !== this.config.provider;
    const hasExplicitBaseUrl = runtimeConfig?.baseUrl !== undefined && runtimeConfig.baseUrl !== '';

    const effectiveConfig = {
      ...this.config,
      ...(runtimeConfig?.apiKey !== undefined && runtimeConfig.apiKey !== '' && { apiKey: runtimeConfig.apiKey }),
      ...(runtimeProvider !== undefined && { provider: runtimeProvider }),
      ...(runtimeConfig?.model !== undefined && runtimeConfig.model !== '' && { model: runtimeConfig.model }),
      // Use explicit baseUrl if provided, otherwise update to match the new provider
      ...(hasExplicitBaseUrl
        ? { baseUrl: runtimeConfig.baseUrl }
        : providerChanged && runtimeProvider in PROVIDER_BASE_URLS
          ? { baseUrl: PROVIDER_BASE_URLS[runtimeProvider as LLMProviderType] }
          : {}),
    };

    if (!effectiveConfig.apiKey) {
      // Always log this warning regardless of verbose flag - it's a significant issue
      console.warn(`[${this.name}] WARNING: No API key configured for provider '${effectiveConfig.provider}'. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or the appropriate key for your provider. Skipping LLM analysis.`);
      return [];
    }

    // Store effective config for use throughout this analysis run
    this.activeConfig = effectiveConfig as Required<LLMAnalyzerConfig>;

    const issues: Issue[] = [];

    // Initialize tools
    this.fileBrowser = new FileBrowser(options.rootDir, this.getConfig().fileBrowserConfig);
    this.toolExecutor = new ToolExecutor(options.rootDir, this.getConfig().toolTimeout);

    try {
      this.log(options, `Starting LLM analysis of ${String(files.length)} files`);

      // Phase 1: Run static tools first to gather context
      const toolContext = await this.runInitialTools(options);

      // Phase 2: Explore and prioritize files
      const exploration = await this.fileBrowser.explore(files);
      this.log(options, `Prioritized ${String(exploration.prioritizedFiles.length)} files for analysis`);

      // Phase 3: Run agentic analysis
      const agentIssues = await this.runAgenticAnalysis(
        exploration.prioritizedFiles.map(f => f.path),
        toolContext,
        options
      );
      issues.push(...agentIssues);

      // Phase 4: Process analysis groups for deeper analysis
      for (const group of exploration.analysisGroups.slice(0, 3)) {
        this.log(options, `Analyzing group: ${group.name}`);
        const groupIssues = await this.analyzeFileGroup(
          group.files.map(f => f.path),
          group.name,
          options
        );
        issues.push(...groupIssues);
      }

      this.log(options, `LLM analysis complete. Found ${String(issues.length)} issues`);
    } catch (error) {
      this.logError('LLM analysis failed', error);
    } finally {
      this.fileBrowser.clearCache();
      this.activeConfig = null; // Clear runtime config after analysis
    }

    return this.deduplicateIssues(issues);
  }

  /**
   * Run initial static tools to gather context
   */
  private async runInitialTools(options: AnalyzerOptions): Promise<string> {
    const contextParts: string[] = [];

    if (this.getConfig().runLint && this.toolExecutor !== null) {
      try {
        this.log(options, 'Running ESLint...');
        const lintResult = await this.toolExecutor.runESLint();
        contextParts.push(`## ESLint Results\n${lintResult.output}`);

        // Convert ESLint issues to analyzer issues immediately
        // These will be deduplicated later
      } catch (error) {
        this.log(options, `ESLint failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (this.getConfig().runTypeCheck && this.toolExecutor !== null) {
      try {
        this.log(options, 'Running TypeScript check...');
        const typeResult = await this.toolExecutor.runTypeCheck();
        contextParts.push(`## TypeScript Check Results\n${typeResult.output}`);
      } catch (error) {
        this.log(options, `TypeScript check failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (this.getConfig().runTests && this.toolExecutor !== null) {
      try {
        this.log(options, 'Running tests...');
        const testResult = await this.toolExecutor.runTests();
        contextParts.push(`## Test Results\n${testResult.output}`);
      } catch (error) {
        this.log(options, `Tests failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (this.getConfig().runBuild && this.toolExecutor !== null) {
      try {
        this.log(options, 'Running build...');
        const buildResult = await this.toolExecutor.runBuild();
        contextParts.push(`## Build Results\n${buildResult.output}`);
      } catch (error) {
        this.log(options, `Build failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return contextParts.join('\n\n');
  }

  /**
   * Run agentic analysis with tool use
   */
  private async runAgenticAnalysis(
    files: string[],
    toolContext: string,
    options: AnalyzerOptions
  ): Promise<Issue[]> {
    const issues: Issue[] = [];
    const messages: Message[] = [];

    // Build system prompt
    const systemPrompt = this.getConfig().systemPrompt || this.buildSystemPrompt();

    // Build initial user message
    const userMessage = this.buildInitialPrompt(files, toolContext, options);

    messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: userMessage });

    // Run agentic loop
    for (let iteration = 0; iteration < this.getConfig().maxIterations; iteration++) {
      this.log(options, `Agentic iteration ${String(iteration + 1)}/${String(this.getConfig().maxIterations)}`);

      try {
        const response = await this.callLLM(messages);

        // Check if response contains tool calls
        if (response.toolCalls && response.toolCalls.length > 0) {
          messages.push({
            role: 'assistant',
            content: response.content,
            toolCalls: response.toolCalls,
          });

          // Execute each tool call
          for (const toolCall of response.toolCalls) {
            const toolResult = await this.executeToolCall(toolCall, issues);
            messages.push({
              role: 'tool',
              content: toolResult,
              toolCallId: toolCall.name,
            });
          }
        } else {
          // No tool calls - extract issues from response
          const parsedIssues = this.parseIssuesFromResponse(response.content, options);
          issues.push(...parsedIssues);

          // Check if LLM wants to continue or is done
          if (response.content.includes('[ANALYSIS_COMPLETE]') ||
              !response.content.includes('create_issue') ||
              iteration >= this.getConfig().maxIterations - 1) {
            break;
          }

          messages.push({ role: 'assistant', content: response.content });
        }
      } catch (error) {
        this.logError(`Iteration ${String(iteration + 1)} failed`, error);
        break;
      }
    }

    return issues;
  }

  /**
   * Analyze a group of related files
   */
  private async analyzeFileGroup(
    files: string[],
    groupName: string,
    options: AnalyzerOptions
  ): Promise<Issue[]> {
    const issues: Issue[] = [];

    // Read file contents
    if (this.fileBrowser === null) {
      return issues;
    }
    const fileContents = await this.fileBrowser.readFiles(files.slice(0, this.getConfig().batchSize));
    if (fileContents.length === 0) {return issues;}

    // Build analysis prompt
    const filesForPrompt = fileContents.map(f => ({
      path: this.getRelativePath(f.path, options.rootDir),
      content: f.content,
    }));

    const analysisPrompt = generateAnalysisPrompt(
      filesForPrompt,
      `Analyzing ${groupName}: ${String(files.length)} related files.${
        this.getConfig().focusAreas.length > 0
          ? `\nFocus areas: ${this.getConfig().focusAreas.join(', ')}`
          : ''
      }`
    );

    try {
      const response = await this.callLLMSimple(
        this.buildSystemPrompt(),
        analysisPrompt
      );

      const parsedIssues = this.parseIssuesFromResponse(response, options);
      issues.push(...parsedIssues);
    } catch (error) {
      this.logError(`Failed to analyze group ${groupName}`, error);
    }

    return issues;
  }

  /**
   * Build system prompt for the LLM
   */
  private buildSystemPrompt(): string {
    return `${LLM_ANALYSIS_SYSTEM_PROMPT}

## Available Tools
You can use the following tools to explore the codebase and gather information:

${TOOL_DEFINITIONS.map(t => `### ${t.name}
${t.description}
Parameters: ${JSON.stringify(t.parameters, null, 2)}`).join('\n\n')}

## Workflow
1. First, examine the initial context (lint/type errors, file list)
2. Use read_file to examine specific files in detail
3. Use search_code to find patterns or usages
4. Use run_* tools to gather more information if needed
5. Create issues using create_issue for each problem found
6. When done, output [ANALYSIS_COMPLETE]

Be thorough but efficient. Focus on high-impact issues first.`;
  }

  /**
   * Build initial prompt for agentic analysis
   */
  private buildInitialPrompt(
    files: string[],
    toolContext: string,
    options: AnalyzerOptions
  ): string {
    return `Please analyze this codebase for issues.

## Project Root
${options.rootDir}

## Files Available for Analysis
${files.slice(0, 50).join('\n')}
${files.length > 50 ? `\n... and ${String(files.length - 50)} more files` : ''}

${toolContext ? `## Initial Tool Results\n${toolContext}` : ''}

${this.getConfig().focusAreas.length > 0 ? `## Focus Areas\nPay special attention to: ${this.getConfig().focusAreas.join(', ')}` : ''}

Start by examining the most important files and look for:
1. Logic bugs and edge cases
2. Security vulnerabilities
3. Missing error handling
4. Performance issues
5. Code smells

Use the tools to explore the codebase and create issues for any problems you find.`;
  }

  /**
   * Call the LLM with tool support
   * Routes to the appropriate API based on provider type
   */
  private async callLLM(messages: Message[]): Promise<{
    content: string;
    toolCalls?: ToolCall[];
  }> {
    // Claude uses native Anthropic API
    if (this.getConfig().provider === 'claude') {
      return this.callAnthropic(messages);
    }
    // All other providers use OpenAI-compatible API
    return this.callOpenAICompatible(messages);
  }

  /**
   * Call Anthropic API
   */
  private async callAnthropic(messages: Message[]): Promise<{
    content: string;
    toolCalls?: ToolCall[];
  }> {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({
      apiKey: this.getConfig().apiKey,
      baseURL: this.getConfig().baseUrl || undefined,
    });

    // Convert messages to Anthropic format
    const systemMessage = messages.find(m => m.role === 'system');
    const conversationMessages = messages
      .filter(m => m.role !== 'system')
      .map(m => {
        if (m.role === 'tool') {
          return {
            role: 'user' as const,
            content: [{
              type: 'tool_result' as const,
              tool_use_id: m.toolCallId ?? 'unknown',
              content: m.content,
            }],
          };
        }
        if (m.toolCalls !== undefined && m.toolCalls.length > 0) {
          return {
            role: 'assistant' as const,
            content: [
              ...(m.content !== '' ? [{ type: 'text' as const, text: m.content }] : []),
              ...m.toolCalls.map(tc => ({
                type: 'tool_use' as const,
                id: tc.name + '_' + String(Date.now()),
                name: tc.name,
                input: tc.parameters,
              })),
            ],
          };
        }
        return {
          role: m.role as 'user' | 'assistant',
          content: m.content,
        };
      });

    // Convert tool definitions to Anthropic format
    const tools = TOOL_DEFINITIONS.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters as { type: 'object'; properties?: Record<string, unknown>; required?: string[] },
    }));

    const response = await client.messages.create({
      model: this.getConfig().model,
      max_tokens: this.getConfig().maxTokens,
      system: systemMessage?.content ?? '',
      messages: conversationMessages,
      tools,
    });

    // Extract content and tool calls
    let content = '';
    const toolCalls: ToolCall[] = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        content += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          name: block.name,
          parameters: block.input as Record<string, unknown>,
        });
      }
    }

    return { content, toolCalls: toolCalls.length > 0 ? toolCalls : undefined };
  }

  /**
   * Call OpenAI-compatible API
   * Used for OpenAI, Ollama, Gemini, OpenRouter, DeepSeek, Mistral, Groq, Together, Cohere
   */
  private async callOpenAICompatible(messages: Message[]): Promise<{
    content: string;
    toolCalls?: ToolCall[];
  }> {
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({
      apiKey: this.getConfig().apiKey || 'ollama', // Ollama doesn't require a key
      baseURL: this.getConfig().baseUrl,
    });

    // Convert messages to OpenAI format
    const openaiMessages = messages.map(m => {
      if (m.role === 'tool') {
        return {
          role: 'tool' as const,
          content: m.content,
          tool_call_id: m.toolCallId ?? 'unknown',
        };
      }
      if (m.toolCalls && m.toolCalls.length > 0) {
        return {
          role: 'assistant' as const,
          content: m.content || null,
          tool_calls: m.toolCalls.map((tc, i) => ({
            id: `call_${String(i)}`,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.parameters),
            },
          })),
        };
      }
      return {
        role: m.role,
        content: m.content,
      };
    });

    // Convert tool definitions to OpenAI format
    const tools = TOOL_DEFINITIONS.map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    const response = await client.chat.completions.create({
      model: this.getConfig().model,
      max_tokens: this.getConfig().maxTokens,
      messages: openaiMessages,
      tools,
    });

    const choice = response.choices[0];
    const message = choice.message;
    const content = message.content ?? '';
    const toolCalls: ToolCall[] = [];

    if (message.tool_calls) {
      for (const tc of message.tool_calls) {
        toolCalls.push({
          name: tc.function.name,
          parameters: JSON.parse(tc.function.arguments) as Record<string, unknown>,
        });
      }
    }

    return { content, toolCalls: toolCalls.length > 0 ? toolCalls : undefined };
  }

  /**
   * Call LLM without tool support (simple completion)
   */
  private async callLLMSimple(systemPrompt: string, userPrompt: string): Promise<string> {
    const response = await this.callLLM([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]);
    return response.content;
  }

  /**
   * Execute a tool call and return the result
   */
  private async executeToolCall(
    toolCall: ToolCall,
    issues: Issue[]
  ): Promise<string> {
    try {
      // Special handling for create_issue
      if (toolCall.name === 'create_issue') {
        const params = toolCall.parameters;
        const issue = this.createIssueFromLLM(params);
        issues.push(issue);
        return `Issue created: ${issue.message}`;
      }

      if (this.toolExecutor === null) {
        return 'Tool executor not initialized';
      }
      const result = await this.toolExecutor.executeTool(toolCall.name, toolCall.parameters);
      return result.output;
    } catch (error) {
      return `Error executing ${toolCall.name}: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  /**
   * Create an issue from LLM parameters
   */
  private createIssueFromLLM(params: Record<string, unknown>): Issue {
    const severity = mapToSeverity(params.severity as string);
    const confidence = typeof params.confidence === 'number' ? params.confidence : 0.8;

    return this.createIssue({
      severity,
      message: params.title as string,
      description: params.description as string,
      location: {
        file: params.file as string,
        line: params.lineStart as number,
        column: 1,
        endLine: params.lineEnd as number,
      },
      suggestion: params.suggestedFix as string | undefined,
      metadata: {
        confidence,
        source: 'llm-analyzer',
        llmCategory: params.type,
      },
    });
  }

  /**
   * Parse issues from LLM response text
   */
  private parseIssuesFromResponse(response: string, options: AnalyzerOptions): Issue[] {
    const issues: Issue[] = [];

    // Try to parse as JSON
    try {
      // Look for JSON in the response
      const jsonMatch = /\{[\s\S]*"issues"[\s\S]*\}/.exec(response);
      if (jsonMatch !== null) {
        const parsed = JSON.parse(jsonMatch[0]) as LLMResponse;
        if (Array.isArray(parsed.issues)) {
          for (const llmIssue of parsed.issues) {
            try {
              const issue = this.convertLLMIssue(llmIssue, options);
              issues.push(issue);
            } catch {
              // Skip invalid issues
            }
          }
        }
      }
    } catch {
      // JSON parsing failed, try to extract issues from text
      this.log(options, 'Could not parse JSON response, extracting issues from text');
    }

    return issues;
  }

  /**
   * Convert an LLM issue to our Issue format
   */
  private convertLLMIssue(llmIssue: LLMIssue, options: AnalyzerOptions): Issue {
    const category = mapToIssueCategory(llmIssue.type);
    const severity = mapToSeverity(llmIssue.severity);

    // Make file path absolute if relative
    let filePath = llmIssue.file;
    if (!filePath.startsWith('/')) {
      filePath = `${options.rootDir}/${filePath}`;
    }

    return this.createIssue({
      id: this.generateIssueId(category, filePath, llmIssue.lineStart, llmIssue.title),
      severity,
      message: llmIssue.title,
      description: llmIssue.description,
      location: {
        file: filePath,
        line: llmIssue.lineStart,
        column: 1,
        endLine: llmIssue.lineEnd,
      },
      suggestion: llmIssue.suggestedFix,
      metadata: {
        confidence: llmIssue.confidence ?? 0.8,
        source: 'llm-analyzer',
        originalCategory: llmIssue.type,
      },
    });
  }

  /**
   * Deduplicate issues
   */
  private deduplicateIssues(issues: Issue[]): Issue[] {
    const seen = new Set<string>();
    const unique: Issue[] = [];

    for (const issue of issues) {
      const key = `${issue.location.file}:${String(issue.location.line)}:${issue.message}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(issue);
      }
    }

    return unique;
  }
}

// Re-export types and components
export { FileBrowser, type FileBrowserConfig, type PrioritizedFile, type AnalysisGroup } from './file-browser.js';
export {
  ToolExecutor,
  TOOL_DEFINITIONS,
  FileLearningsStore,
  type LearningsStore,
  type LearningEntry,
} from './tool-executor.js';
export {
  ReAnalysisLoop,
  createReAnalysisRunner,
  type ReAnalysisConfig,
  type ReAnalysisResult,
  type AnalysisLoopResult,
} from './re-analysis.js';
export * from './prompts.js';
