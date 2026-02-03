import {
  BaseProvider,
  ProviderConfig,
  ProviderError,
  RateLimitError,
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

export type OllamaModel =
  | 'codellama'
  | 'codellama:7b'
  | 'codellama:13b'
  | 'codellama:34b'
  | 'deepseek-coder'
  | 'deepseek-coder:6.7b'
  | 'deepseek-coder:33b'
  | 'llama3'
  | 'llama3:8b'
  | 'llama3:70b'
  | 'mixtral'
  | 'mixtral:8x7b'
  | 'qwen2.5-coder'
  | 'qwen2.5-coder:7b'
  | 'qwen2.5-coder:32b'
  | string; // Allow any model name

export interface OllamaProviderConfig extends ProviderConfig {
  model?: OllamaModel;
  baseUrl?: string;
  analysisType?: AnalysisType;
  keepAlive?: string; // Duration to keep model in memory (e.g., "5m", "1h")
  numCtx?: number; // Context window size
  numGpu?: number; // Number of GPU layers
}

interface OllamaGenerateRequest {
  model: string;
  prompt: string;
  system?: string;
  stream?: boolean;
  options?: {
    temperature?: number;
    num_ctx?: number;
    num_gpu?: number;
  };
  keep_alive?: string;
}

interface OllamaGenerateResponse {
  model: string;
  created_at: string;
  response: string;
  done: boolean;
  context?: number[];
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

interface OllamaStreamResponse {
  model: string;
  created_at: string;
  response: string;
  done: boolean;
}

// ============================================================================
// Ollama Provider
// ============================================================================

export class OllamaProvider extends BaseProvider {
  private readonly baseUrl: string;
  private readonly model: OllamaModel;
  private analysisType: AnalysisType;
  private readonly keepAlive: string;
  private readonly numCtx: number | undefined;
  private readonly numGpu: number | undefined;

  constructor(config: OllamaProviderConfig = {}) {
    super({
      ...config,
      model: config.model ?? 'codellama',
      maxTokens: config.maxTokens ?? 4096,
      timeout: config.timeout ?? 300000, // 5 minutes for local models
      // Local models don't have rate limits like cloud APIs
      rateLimitRpm: config.rateLimitRpm ?? 1000,
      rateLimitTpm: config.rateLimitTpm ?? 1000000,
    });

    this.baseUrl = config.baseUrl ?? 'http://localhost:11434';
    this.model = config.model ?? 'codellama';
    this.analysisType = config.analysisType ?? 'full';
    this.keepAlive = config.keepAlive ?? '5m';
    this.numCtx = config.numCtx;
    this.numGpu = config.numGpu;
  }

  get name(): string {
    return `Ollama (${this.model})`;
  }

  // ============================================================================
  // Health Check
  // ============================================================================

  /**
   * Check if Ollama server is running and the model is available
   */
  async healthCheck(): Promise<{ healthy: boolean; models: string[]; error?: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        return {
          healthy: false,
          models: [],
          error: `Ollama server returned ${response.status}`,
        };
      }

      const data = await response.json() as { models?: Array<{ name: string }> };
      const models = data.models?.map(m => m.name) ?? [];

      return {
        healthy: true,
        models,
      };
    } catch (error) {
      return {
        healthy: false,
        models: [],
        error: error instanceof Error ? error.message : 'Failed to connect to Ollama',
      };
    }
  }

  /**
   * Pull a model if it's not already available
   */
  async pullModel(modelName?: string): Promise<void> {
    const model = modelName ?? this.model;

    const response = await fetch(`${this.baseUrl}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: model }),
    });

    if (!response.ok) {
      throw new ProviderError(
        `Failed to pull model ${model}: ${response.statusText}`,
        'MODEL_PULL_FAILED',
        false,
        response.status,
      );
    }

    // Wait for pull to complete (streaming response)
    const reader = response.body?.getReader();
    if (reader) {
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
    }
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

    const response = await this.callOllama(
      ANALYSIS_SYSTEM_PROMPT,
      userPrompt,
      callbacks,
    );

    return parseAnalysisResponse(response, files, startTime);
  }

  /**
   * Analyze code with explicit file contents
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

    const response = await this.callOllama(
      ANALYSIS_SYSTEM_PROMPT,
      userPrompt,
      callbacks,
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

    const response = await this.callOllama(
      FIX_SYSTEM_PROMPT,
      userPrompt,
      callbacks,
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

    const response = await this.callOllama(
      VERIFY_SYSTEM_PROMPT,
      userPrompt,
      callbacks,
    );

    return parseVerifyResponse(response);
  }

  // ============================================================================
  // API Interaction
  // ============================================================================

  private async callOllama(
    systemPrompt: string,
    userPrompt: string,
    callbacks?: StreamCallbacks,
  ): Promise<string> {
    const fullPrompt = `${userPrompt}`;

    // Build options object, only including defined values
    const options: { temperature?: number; num_ctx?: number; num_gpu?: number } = {
      temperature: this.config.temperature,
    };
    if (this.numCtx !== undefined) {
      options.num_ctx = this.numCtx;
    }
    if (this.numGpu !== undefined) {
      options.num_gpu = this.numGpu;
    }

    const request: OllamaGenerateRequest = {
      model: this.model,
      prompt: fullPrompt,
      system: systemPrompt,
      stream: !!callbacks?.onToken,
      options,
      keep_alive: this.keepAlive,
    };

    try {
      if (callbacks?.onToken) {
        return await this.callOllamaStreaming(request, callbacks);
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

      try {
        const response = await fetch(`${this.baseUrl}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw await this.handleHttpError(response);
        }

        const data = await response.json() as OllamaGenerateResponse;
        return data.response;
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error) {
      throw this.handleError(error);
    }
  }

  private async callOllamaStreaming(
    request: OllamaGenerateRequest,
    callbacks: StreamCallbacks,
  ): Promise<string> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...request, stream: true }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw await this.handleHttpError(response);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new InvalidResponseError('No response body', response);
      }

      const decoder = new TextDecoder();
      let fullContent = '';
      let totalChunks = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter(l => l.trim());

        for (const line of lines) {
          try {
            const data = JSON.parse(line) as OllamaStreamResponse;
            if (data.response) {
              fullContent += data.response;
              callbacks.onToken?.(data.response);
              totalChunks++;
              // Estimate progress based on typical response length
              callbacks.onProgress?.(Math.min(0.99, totalChunks / 500));
            }
            if (data.done) {
              callbacks.onProgress?.(1);
            }
          } catch {
            // Skip invalid JSON lines
          }
        }
      }

      return fullContent;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ============================================================================
  // Error Handling
  // ============================================================================

  private async handleHttpError(response: Response): Promise<ProviderError> {
    let message = `HTTP ${response.status}: ${response.statusText}`;

    try {
      const errorData = await response.json() as { error?: string };
      if (errorData.error) {
        message = errorData.error;
      }
    } catch {
      // Use default message
    }

    if (response.status === 429) {
      return new RateLimitError(message);
    }

    if (response.status === 404) {
      return new ProviderError(
        `Model not found: ${this.model}. Run 'ollama pull ${this.model}' first.`,
        'MODEL_NOT_FOUND',
        false,
        404,
      );
    }

    return new ProviderError(
      message,
      'HTTP_ERROR',
      response.status >= 500,
      response.status,
    );
  }

  private handleError(error: unknown): never {
    if (error instanceof ProviderError) {
      throw error;
    }

    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        throw new TimeoutError(`Request timed out after ${this.config.timeout}ms`);
      }

      if (error.message.includes('ECONNREFUSED')) {
        throw new ProviderError(
          `Cannot connect to Ollama at ${this.baseUrl}. Is Ollama running?`,
          'CONNECTION_REFUSED',
          true,
        );
      }

      throw new ProviderError(error.message, 'UNKNOWN', false, undefined, error);
    }

    throw new ProviderError(String(error), 'UNKNOWN', false);
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

  /**
   * Get the Ollama server URL
   */
  getBaseUrl(): string {
    return this.baseUrl;
  }
}

export default OllamaProvider;
