import OpenAI from 'openai';
import {
  BaseProvider,
  ProviderConfig,
  ProviderError,
  RateLimitError,
  AuthenticationError,
  TimeoutError,
  InvalidResponseError,
  AnalysisResult,
  FixResult,
  VerifyResult,
  Issue,
  StreamCallbacks,
} from '../base.js';
import {
  ANALYSIS_SYSTEM_PROMPT,
  generateAnalysisUserPrompt,
  parseAnalysisResponse,
  AnalysisType,
} from '../prompts/analysis.js';
import {
  FIX_SYSTEM_PROMPT,
  generateFixUserPrompt,
  parseFixResponse,
} from '../prompts/fix.js';
import {
  VERIFY_SYSTEM_PROMPT,
  generateVerifyUserPrompt,
  parseVerifyResponse,
} from '../prompts/verify.js';

// ============================================================================
// Types
// ============================================================================

export type OpenAIModel =
  | 'gpt-4o'
  | 'gpt-4o-mini'
  | 'gpt-4-turbo'
  | 'gpt-4-turbo-preview'
  | 'gpt-4'
  | 'gpt-3.5-turbo';

export interface OpenAIProviderConfig extends ProviderConfig {
  model?: OpenAIModel;
  apiKey?: string;
  organization?: string;
  baseUrl?: string;
  analysisType?: AnalysisType;
}

// ============================================================================
// OpenAI Provider
// ============================================================================

export class OpenAIProvider extends BaseProvider {
  private client: OpenAI;
  private readonly model: OpenAIModel;
  private analysisType: AnalysisType;

  constructor(config: OpenAIProviderConfig = {}) {
    super({
      ...config,
      model: config.model ?? 'gpt-4o',
      maxTokens: config.maxTokens ?? 4096,
      rateLimitRpm: config.rateLimitRpm ?? 60,
      rateLimitTpm: config.rateLimitTpm ?? 150000,
    });

    this.model = (config.model ?? 'gpt-4o');
    this.analysisType = config.analysisType ?? 'full';

    const apiKey = config.apiKey ?? process.env.OPENAI_API_KEY;
    if (apiKey === undefined || apiKey === '') {
      throw new AuthenticationError('OpenAI API key is required. Set OPENAI_API_KEY environment variable or pass apiKey in config.');
    }

    this.client = new OpenAI({
      apiKey,
      organization: config.organization,
      baseURL: config.baseUrl,
      timeout: this.config.timeout,
    });
  }

  get name(): string {
    return `OpenAI (${this.model})`;
  }

  // ============================================================================
  // Code Analysis
  // ============================================================================

  async analyzeCode(
    files: string[],
    context: string,
    callbacks?: StreamCallbacks,
  ): Promise<AnalysisResult> {
    const startTime = Date.now();

    const fileContents = files.map(filePath => ({
      path: filePath,
      content: `// Content of ${filePath} would be read here`,
      language: this.detectLanguage(filePath),
    }));

    const userPrompt = generateAnalysisUserPrompt({
      type: this.analysisType,
      files: fileContents,
      context,
    });

    const estimatedTokens = this.estimateTokens(ANALYSIS_SYSTEM_PROMPT + userPrompt);

    const response = await this.withRateLimitAndRetry(
      () => this.callOpenAI(ANALYSIS_SYSTEM_PROMPT, userPrompt, callbacks),
      estimatedTokens,
    );

    return parseAnalysisResponse(response, files, startTime);
  }

  /**
   * Analyze code with explicit file contents
   */
  async analyzeCodeWithContents(
    files: { path: string; content: string }[],
    context: string,
    callbacks?: StreamCallbacks,
  ): Promise<AnalysisResult> {
    const startTime = Date.now();

    const fileContents = files.map(f => ({
      ...f,
      language: this.detectLanguage(f.path),
    }));

    const userPrompt = generateAnalysisUserPrompt({
      type: this.analysisType,
      files: fileContents,
      context,
    });

    const estimatedTokens = this.estimateTokens(ANALYSIS_SYSTEM_PROMPT + userPrompt);

    const response = await this.withRateLimitAndRetry(
      () => this.callOpenAI(ANALYSIS_SYSTEM_PROMPT, userPrompt, callbacks),
      estimatedTokens,
    );

    return parseAnalysisResponse(response, files.map(f => f.path), startTime);
  }

  // ============================================================================
  // Issue Fixing
  // ============================================================================

  async fixIssue(
    issue: Issue,
    fileContent: string,
    callbacks?: StreamCallbacks,
  ): Promise<FixResult> {
    const userPrompt = generateFixUserPrompt({
      issue,
      fileContent,
      filePath: issue.location.file,
    });

    const estimatedTokens = this.estimateTokens(FIX_SYSTEM_PROMPT + userPrompt);

    const response = await this.withRateLimitAndRetry(
      () => this.callOpenAI(FIX_SYSTEM_PROMPT, userPrompt, callbacks),
      estimatedTokens,
    );

    return parseFixResponse(response);
  }

  // ============================================================================
  // Fix Verification
  // ============================================================================

  async verifyFix(
    issue: Issue,
    diff: string,
    fileContent: string,
    callbacks?: StreamCallbacks,
  ): Promise<VerifyResult> {
    const newContent = this.applySimpleDiff(fileContent, diff);

    const userPrompt = generateVerifyUserPrompt({
      issue,
      diff,
      originalContent: fileContent,
      newContent,
      filePath: issue.location.file,
    });

    const estimatedTokens = this.estimateTokens(VERIFY_SYSTEM_PROMPT + userPrompt);

    const response = await this.withRateLimitAndRetry(
      () => this.callOpenAI(VERIFY_SYSTEM_PROMPT, userPrompt, callbacks),
      estimatedTokens,
    );

    return parseVerifyResponse(response);
  }

  // ============================================================================
  // API Interaction
  // ============================================================================

  private async callOpenAI(
    systemPrompt: string,
    userPrompt: string,
    callbacks?: StreamCallbacks,
  ): Promise<string> {
    try {
      if (callbacks?.onToken) {
        return await this.callOpenAIStreaming(systemPrompt, userPrompt, callbacks);
      }

      const response = await this.client.chat.completions.create({
        model: this.model,
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
        messages: [
          {
            role: 'system',
            content: systemPrompt,
          },
          {
            role: 'user',
            content: userPrompt,
          },
        ],
        response_format: { type: 'json_object' },
      });

      const content = response.choices[0]?.message?.content ?? '';
      if (content === '') {
        throw new InvalidResponseError('No content in response', response);
      }

      return content;
    } catch (error) {
      this.handleApiError(error);
    }
  }

  private async callOpenAIStreaming(
    systemPrompt: string,
    userPrompt: string,
    callbacks: StreamCallbacks,
  ): Promise<string> {
    const stream = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: this.config.maxTokens,
      temperature: this.config.temperature,
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        {
          role: 'user',
          content: userPrompt,
        },
      ],
      stream: true,
    });

    let fullContent = '';
    let totalTokens = 0;
    const estimatedTotalTokens = this.estimateTokens(systemPrompt + userPrompt) + this.config.maxTokens;

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content !== undefined && content !== null && content !== '') {
        fullContent += content;
        callbacks.onToken?.(content);

        totalTokens += this.estimateTokens(content);
        callbacks.onProgress?.(Math.min(0.99, totalTokens / estimatedTotalTokens));
      }
    }

    callbacks.onProgress?.(1);
    return fullContent;
  }

  // ============================================================================
  // JSON Mode Support
  // ============================================================================

  /**
   * Call OpenAI with structured JSON output using function calling
   */
  async callWithStructuredOutput<T>(
    systemPrompt: string,
    userPrompt: string,
    schema: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    },
  ): Promise<T> {
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        tools: [
          {
            type: 'function',
            function: schema,
          },
        ],
        tool_choice: { type: 'function', function: { name: schema.name } },
      });

      const toolCall = response.choices[0]?.message?.tool_calls?.[0];
      if (toolCall?.function.name !== schema.name) {
        throw new InvalidResponseError('No valid tool call in response', response);
      }

      return JSON.parse(toolCall.function.arguments) as T;
    } catch (error) {
      this.handleApiError(error);
    }
  }

  // ============================================================================
  // Error Handling
  // ============================================================================

  private handleApiError(error: unknown): never {
    if (error instanceof OpenAI.APIError) {
      const status = typeof error.status === 'number' ? error.status : undefined;
      const message = error.message;

      if (status === 401) {
        throw new AuthenticationError(`Authentication failed: ${message}`);
      }

      if (status === 429) {
        const retryAfter = this.extractRetryAfter(error);
        throw new RateLimitError(`Rate limit exceeded: ${message}`, retryAfter);
      }

      if (status === 408 || status === 504) {
        throw new TimeoutError(`Request timed out: ${message}`);
      }

      if (status === 500 || status === 502 || status === 503) {
        throw new ProviderError(
          `Server error: ${message}`,
          'SERVER_ERROR',
          true,
          status,
        );
      }

      throw new ProviderError(
        `API error: ${message}`,
        'API_ERROR',
        status !== undefined && status >= 500,
        status,
      );
    }

    if (error instanceof Error) {
      if (error.message.includes('timeout')) {
        throw new TimeoutError(`Request timed out: ${error.message}`);
      }
      throw new ProviderError(error.message, 'UNKNOWN', false, undefined, error);
    }

    throw new ProviderError(String(error), 'UNKNOWN', false);
  }

  private extractRetryAfter(error: unknown): number | undefined {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
    const headers = (error as any).headers as Record<string, string> | undefined;
    if (headers !== undefined) {
      const retryAfter = headers['retry-after'];
      if (typeof retryAfter === 'string') {
        const parsed = parseInt(retryAfter, 10);
        if (!isNaN(parsed)) {
          return parsed;
        }
      }
    }
    return undefined;
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  private detectLanguage(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
    const languageMap: Record<string, string> = {
      ts: 'typescript',
      tsx: 'typescript',
      js: 'javascript',
      jsx: 'javascript',
      py: 'python',
      rb: 'ruby',
      go: 'go',
      rs: 'rust',
      java: 'java',
      kt: 'kotlin',
      swift: 'swift',
      cs: 'csharp',
      cpp: 'cpp',
      c: 'c',
      h: 'c',
      hpp: 'cpp',
      php: 'php',
    };
    return languageMap[ext] ?? ext;
  }

  private applySimpleDiff(content: string, diff: string): string {
    const lines = content.split('\n');
    const result = [...lines];

    const hunkRegex = /@@ -(\d+),?\d* \+(\d+),?\d* @@/g;
    let match;
    let offset = 0;

    while ((match = hunkRegex.exec(diff)) !== null) {
      const originalStart = parseInt(match[1], 10) - 1;
      const hunkStart = match.index;
      const nextHunk = diff.indexOf('@@', hunkStart + match[0].length);
      const hunkContent = nextHunk === -1
        ? diff.slice(hunkStart + match[0].length)
        : diff.slice(hunkStart + match[0].length, nextHunk);

      const hunkLines = hunkContent.split('\n').filter(l => l.length > 0);
      let currentLine = originalStart + offset;

      for (const line of hunkLines) {
        if (line.startsWith('-')) {
          result.splice(currentLine, 1);
          offset--;
        } else if (line.startsWith('+')) {
          result.splice(currentLine, 0, line.slice(1));
          currentLine++;
          offset++;
        } else if (line.startsWith(' ')) {
          currentLine++;
        }
      }
    }

    return result.join('\n');
  }

  /**
   * Set the analysis type for subsequent analyses
   */
  setAnalysisType(type: AnalysisType): void {
    this.analysisType = type;
  }
}

export default OpenAIProvider;
