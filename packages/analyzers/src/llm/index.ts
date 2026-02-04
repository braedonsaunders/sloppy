/**
 * LLM Analyzer
 *
 * An agentic code analyzer that uses LLMs to detect issues
 * beyond what static analyzers can find. The LLM orchestrates
 * the entire analysis process, including running other tools.
 */

import {
  BaseAnalyzer,
  type Issue,
  type AnalyzerOptions,
  type IssueCategory,
  type Severity,
  type FileContent,
} from '../base.js';
import { FileBrowser, type FileBrowserConfig } from './file-browser.js';
import { ToolExecutor, TOOL_DEFINITIONS, type ESLintIssue, type TypeScriptError } from './tool-executor.js';
import {
  LLM_ANALYSIS_SYSTEM_PROMPT,
  generateAnalysisPrompt,
  mapToIssueCategory,
  mapToSeverity,
} from './prompts.js';

/**
 * Configuration for the LLM analyzer
 */
export interface LLMAnalyzerConfig {
  /** API key for the LLM provider */
  apiKey?: string;
  /** LLM model to use (default: claude-sonnet-4-20250514) */
  model?: string;
  /** LLM provider (default: anthropic) */
  provider?: 'anthropic' | 'openai';
  /** Base URL for the LLM API */
  baseUrl?: string;
  /** Maximum tokens for analysis response */
  maxTokens?: number;
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
 * LLM Analyzer - Agentic code analysis using LLMs
 */
export class LLMAnalyzer extends BaseAnalyzer {
  readonly name = 'llm-analyzer';
  readonly description = 'AI-powered deep code analysis for logic bugs, security issues, and code smells';
  readonly category: IssueCategory = 'llm';

  private readonly config: Required<LLMAnalyzerConfig>;
  private fileBrowser: FileBrowser | null = null;
  private toolExecutor: ToolExecutor | null = null;

  constructor(config: LLMAnalyzerConfig = {}) {
    super();
    this.config = {
      apiKey: config.apiKey ?? process.env['ANTHROPIC_API_KEY'] ?? process.env['OPENAI_API_KEY'] ?? '',
      model: config.model ?? 'claude-sonnet-4-20250514',
      provider: config.provider ?? 'anthropic',
      baseUrl: config.baseUrl ?? '',
      maxTokens: config.maxTokens ?? 8192,
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
    };
  }

  /**
   * Analyze files using LLM-powered agentic analysis
   */
  async analyze(files: string[], options: AnalyzerOptions): Promise<Issue[]> {
    if (!this.config.apiKey) {
      this.log(options, 'No API key configured, skipping LLM analysis');
      return [];
    }

    const issues: Issue[] = [];

    // Initialize tools
    this.fileBrowser = new FileBrowser(options.rootDir, this.config.fileBrowserConfig);
    this.toolExecutor = new ToolExecutor(options.rootDir, this.config.toolTimeout);

    try {
      this.log(options, `Starting LLM analysis of ${files.length} files`);

      // Phase 1: Run static tools first to gather context
      const toolContext = await this.runInitialTools(options);

      // Phase 2: Explore and prioritize files
      const exploration = await this.fileBrowser.explore(files);
      this.log(options, `Prioritized ${exploration.prioritizedFiles.length} files for analysis`);

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

      this.log(options, `LLM analysis complete. Found ${issues.length} issues`);
    } catch (error) {
      this.logError('LLM analysis failed', error);
    } finally {
      this.fileBrowser?.clearCache();
    }

    return this.deduplicateIssues(issues);
  }

  /**
   * Run initial static tools to gather context
   */
  private async runInitialTools(options: AnalyzerOptions): Promise<string> {
    const contextParts: string[] = [];

    if (this.config.runLint) {
      try {
        this.log(options, 'Running ESLint...');
        const lintResult = await this.toolExecutor!.runESLint();
        contextParts.push(`## ESLint Results\n${lintResult.output}`);

        // Convert ESLint issues to analyzer issues immediately
        // These will be deduplicated later
      } catch (error) {
        this.log(options, `ESLint failed: ${error}`);
      }
    }

    if (this.config.runTypeCheck) {
      try {
        this.log(options, 'Running TypeScript check...');
        const typeResult = await this.toolExecutor!.runTypeCheck();
        contextParts.push(`## TypeScript Check Results\n${typeResult.output}`);
      } catch (error) {
        this.log(options, `TypeScript check failed: ${error}`);
      }
    }

    if (this.config.runTests) {
      try {
        this.log(options, 'Running tests...');
        const testResult = await this.toolExecutor!.runTests();
        contextParts.push(`## Test Results\n${testResult.output}`);
      } catch (error) {
        this.log(options, `Tests failed: ${error}`);
      }
    }

    if (this.config.runBuild) {
      try {
        this.log(options, 'Running build...');
        const buildResult = await this.toolExecutor!.runBuild();
        contextParts.push(`## Build Results\n${buildResult.output}`);
      } catch (error) {
        this.log(options, `Build failed: ${error}`);
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
    const systemPrompt = this.config.systemPrompt || this.buildSystemPrompt();

    // Build initial user message
    const userMessage = this.buildInitialPrompt(files, toolContext, options);

    messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: userMessage });

    // Run agentic loop
    for (let iteration = 0; iteration < this.config.maxIterations; iteration++) {
      this.log(options, `Agentic iteration ${iteration + 1}/${this.config.maxIterations}`);

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
              iteration >= this.config.maxIterations - 1) {
            break;
          }

          messages.push({ role: 'assistant', content: response.content });
        }
      } catch (error) {
        this.logError(`Iteration ${iteration + 1} failed`, error);
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
    const fileContents = await this.fileBrowser!.readFiles(files.slice(0, this.config.batchSize));
    if (fileContents.length === 0) return issues;

    // Build analysis prompt
    const filesForPrompt = fileContents.map(f => ({
      path: this.getRelativePath(f.path, options.rootDir),
      content: f.content,
    }));

    const analysisPrompt = generateAnalysisPrompt(
      filesForPrompt,
      `Analyzing ${groupName}: ${files.length} related files.${
        this.config.focusAreas.length > 0
          ? `\nFocus areas: ${this.config.focusAreas.join(', ')}`
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
${files.length > 50 ? `\n... and ${files.length - 50} more files` : ''}

${toolContext ? `## Initial Tool Results\n${toolContext}` : ''}

${this.config.focusAreas.length > 0 ? `## Focus Areas\nPay special attention to: ${this.config.focusAreas.join(', ')}` : ''}

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
   */
  private async callLLM(messages: Message[]): Promise<{
    content: string;
    toolCalls?: ToolCall[];
  }> {
    if (this.config.provider === 'anthropic') {
      return this.callAnthropic(messages);
    } else {
      return this.callOpenAI(messages);
    }
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
      apiKey: this.config.apiKey,
      baseURL: this.config.baseUrl || undefined,
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
        if (m.toolCalls && m.toolCalls.length > 0) {
          return {
            role: 'assistant' as const,
            content: [
              ...(m.content ? [{ type: 'text' as const, text: m.content }] : []),
              ...m.toolCalls.map(tc => ({
                type: 'tool_use' as const,
                id: tc.name + '_' + Date.now(),
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
      model: this.config.model,
      max_tokens: this.config.maxTokens,
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
   * Call OpenAI API
   */
  private async callOpenAI(messages: Message[]): Promise<{
    content: string;
    toolCalls?: ToolCall[];
  }> {
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({
      apiKey: this.config.apiKey,
      baseURL: this.config.baseUrl || undefined,
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
            id: `call_${i}`,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.parameters),
            },
          })),
        };
      }
      return {
        role: m.role as 'system' | 'user' | 'assistant',
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
      model: this.config.model,
      max_tokens: this.config.maxTokens,
      messages: openaiMessages,
      tools,
    });

    const choice = response.choices[0];
    const content = choice?.message?.content ?? '';
    const toolCalls: ToolCall[] = [];

    if (choice?.message?.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        toolCalls.push({
          name: tc.function.name,
          parameters: JSON.parse(tc.function.arguments),
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

      const result = await this.toolExecutor!.executeTool(toolCall.name, toolCall.parameters);
      return result.output;
    } catch (error) {
      return `Error executing ${toolCall.name}: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  /**
   * Create an issue from LLM parameters
   */
  private createIssueFromLLM(params: Record<string, unknown>): Issue {
    const category = mapToIssueCategory(params.type as string);
    const severity = mapToSeverity(params.severity as string);

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
        confidence: params.confidence as number ?? 0.8,
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
      const jsonMatch = response.match(/\{[\s\S]*"issues"[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as LLMResponse;
        if (parsed.issues && Array.isArray(parsed.issues)) {
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
      const key = `${issue.location.file}:${issue.location.line}:${issue.message}`;
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
export { ToolExecutor, TOOL_DEFINITIONS } from './tool-executor.js';
export {
  ReAnalysisLoop,
  createReAnalysisRunner,
  type ReAnalysisConfig,
  type ReAnalysisResult,
  type AnalysisLoopResult,
} from './re-analysis.js';
export * from './prompts.js';
