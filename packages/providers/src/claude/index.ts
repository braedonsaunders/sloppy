import Anthropic from '@anthropic-ai/sdk';
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

export type ClaudeModel =
  | 'claude-sonnet-4-20250514'
  | 'claude-opus-4-20250514'
  | 'claude-3-5-sonnet-20241022'
  | 'claude-3-5-haiku-20241022';

export interface ClaudeProviderConfig extends ProviderConfig {
  model?: ClaudeModel;
  apiKey?: string;
  baseUrl?: string;
  analysisType?: AnalysisType;
}

// ============================================================================
// Claude Provider
// ============================================================================

export class ClaudeProvider extends BaseProvider {
  private client: Anthropic;
  private readonly model: ClaudeModel;
  private analysisType: AnalysisType;

  constructor(config: ClaudeProviderConfig = {}) {
    super({
      ...config,
      model: config.model ?? 'claude-sonnet-4-20250514',
      maxTokens: config.maxTokens ?? 8192,
      rateLimitRpm: config.rateLimitRpm ?? 50,
      rateLimitTpm: config.rateLimitTpm ?? 80000,
    });

    this.model = (config.model ?? 'claude-sonnet-4-20250514') as ClaudeModel;
    this.analysisType = config.analysisType ?? 'full';

    const apiKey = config.apiKey ?? process.env['ANTHROPIC_API_KEY'];
    if (!apiKey) {
      throw new AuthenticationError('Anthropic API key is required. Set ANTHROPIC_API_KEY environment variable or pass apiKey in config.');
    }

    this.client = new Anthropic({
      apiKey,
      baseURL: config.baseUrl,
      timeout: this.config.timeout,
    });
  }

  get name(): string {
    return `Claude (${this.model})`;
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

    // Prepare file contents (in real implementation, read from disk)
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
      () => this.callClaude(ANALYSIS_SYSTEM_PROMPT, userPrompt, callbacks),
      estimatedTokens,
    );

    return parseAnalysisResponse(response, files, startTime);
  }

  /**
   * Analyze code with explicit file contents (for when caller has already read files)
   */
  async analyzeCodeWithContents(
    files: Array<{ path: string; content: string }>,
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
      () => this.callClaude(ANALYSIS_SYSTEM_PROMPT, userPrompt, callbacks),
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
      () => this.callClaude(FIX_SYSTEM_PROMPT, userPrompt, callbacks),
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
    // Apply diff to get new content (simplified - in production use proper diff lib)
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
      () => this.callClaude(VERIFY_SYSTEM_PROMPT, userPrompt, callbacks),
      estimatedTokens,
    );

    return parseVerifyResponse(response);
  }

  // ============================================================================
  // API Interaction
  // ============================================================================

  private async callClaude(
    systemPrompt: string,
    userPrompt: string,
    callbacks?: StreamCallbacks,
  ): Promise<string> {
    try {
      if (callbacks?.onToken) {
        return await this.callClaudeStreaming(systemPrompt, userPrompt, callbacks);
      }

      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: userPrompt,
          },
        ],
      });

      // Extract text content from response
      const textContent = response.content.find(block => block.type === 'text');
      if (!textContent || textContent.type !== 'text') {
        throw new InvalidResponseError('No text content in response', response);
      }

      return textContent.text;
    } catch (error) {
      throw this.handleApiError(error);
    }
  }

  private async callClaudeStreaming(
    systemPrompt: string,
    userPrompt: string,
    callbacks: StreamCallbacks,
  ): Promise<string> {
    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: this.config.maxTokens,
      temperature: this.config.temperature,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: userPrompt,
        },
      ],
    });

    let fullContent = '';
    let totalTokens = 0;
    const estimatedTotalTokens = this.estimateTokens(systemPrompt + userPrompt) + this.config.maxTokens;

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        const text = event.delta.text;
        fullContent += text;
        callbacks.onToken?.(text);

        // Update progress estimate
        totalTokens += this.estimateTokens(text);
        callbacks.onProgress?.(Math.min(0.99, totalTokens / estimatedTotalTokens));
      }
    }

    callbacks.onProgress?.(1);
    return fullContent;
  }

  // ============================================================================
  // Error Handling
  // ============================================================================

  private handleApiError(error: unknown): never {
    if (error instanceof Anthropic.APIError) {
      const status = error.status;
      const message = error.message;

      if (status === 401) {
        throw new AuthenticationError(`Authentication failed: ${message}`);
      }

      if (status === 429) {
        // Try to extract retry-after from headers
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

  private extractRetryAfter(error: InstanceType<typeof Anthropic.APIError>): number | undefined {
    // Anthropic SDK may include retry-after in error details
    const headers = (error as unknown as { headers?: Record<string, string> }).headers;
    if (headers?.['retry-after']) {
      const retryAfter = parseInt(headers['retry-after'], 10);
      if (!isNaN(retryAfter)) {
        return retryAfter;
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
    // Simplified diff application
    // In production, use a proper diff library like 'diff' or 'jsdiff'
    const lines = content.split('\n');
    const result = [...lines];

    // Parse hunks from diff
    const hunkRegex = /@@ -(\d+),?\d* \+(\d+),?\d* @@/g;
    let match;
    let offset = 0;

    while ((match = hunkRegex.exec(diff)) !== null) {
      const originalStart = parseInt(match[1] ?? '1', 10) - 1;
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

export default ClaudeProvider;
