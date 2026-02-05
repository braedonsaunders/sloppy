import { z } from 'zod';

// ============================================================================
// Types and Schemas
// ============================================================================

export const IssueSeveritySchema = z.enum(['error', 'warning', 'info', 'hint']);
export type IssueSeverity = z.infer<typeof IssueSeveritySchema>;

export const IssueCategorySchema = z.enum([
  'bug',
  'security',
  'performance',
  'maintainability',
  'style',
  'complexity',
  'duplication',
  'documentation',
  'testing',
  'accessibility',
  'compatibility',
  'other',
]);
export type IssueCategory = z.infer<typeof IssueCategorySchema>;

export const IssueLocationSchema = z.object({
  file: z.string(),
  startLine: z.number(),
  endLine: z.number(),
  startColumn: z.number().optional(),
  endColumn: z.number().optional(),
});
export type IssueLocation = z.infer<typeof IssueLocationSchema>;

export const IssueSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  severity: IssueSeveritySchema,
  category: IssueCategorySchema,
  location: IssueLocationSchema,
  suggestedFix: z.string().optional(),
  confidence: z.number().min(0).max(1),
  references: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
});
export type Issue = z.infer<typeof IssueSchema>;

export const AnalysisResultSchema = z.object({
  issues: z.array(IssueSchema),
  summary: z.string(),
  overallScore: z.number().min(0).max(100),
  metrics: z.record(z.string(), z.number()).optional(),
  analyzedFiles: z.array(z.string()),
  timestamp: z.string(),
  duration: z.number(),
});
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;

export const FixResultSchema = z.object({
  success: z.boolean(),
  diff: z.string(),
  newContent: z.string(),
  explanation: z.string(),
  confidence: z.number().min(0).max(1),
  sideEffects: z.array(z.string()).optional(),
  alternativeFixes: z.array(z.object({
    diff: z.string(),
    explanation: z.string(),
  })).optional(),
});
export type FixResult = z.infer<typeof FixResultSchema>;

export const VerifyResultSchema = z.object({
  isValid: z.boolean(),
  reasoning: z.string(),
  concerns: z.array(z.string()),
  suggestions: z.array(z.string()).optional(),
  confidence: z.number().min(0).max(1),
});
export type VerifyResult = z.infer<typeof VerifyResultSchema>;

export interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  timeout?: number;
  maxRetries?: number;
  rateLimitRpm?: number;
  rateLimitTpm?: number;
}

export interface StreamCallbacks {
  onToken?: (token: string) => void;
  onProgress?: (progress: number) => void;
  onError?: (error: Error) => void;
}

// ============================================================================
// Errors
// ============================================================================

export class ProviderError extends Error {
  public readonly code: string;
  public readonly retryable: boolean;
  public readonly statusCode: number | undefined;
  public override readonly cause: Error | undefined;

  constructor(
    message: string,
    code: string,
    retryable = false,
    statusCode?: number,
    cause?: Error,
  ) {
    super(message, { cause });
    this.name = 'ProviderError';
    this.code = code;
    this.retryable = retryable;
    this.statusCode = statusCode;
    this.cause = cause;
  }
}

export class RateLimitError extends ProviderError {
  constructor(
    message: string,
    public readonly retryAfter?: number,
  ) {
    super(message, 'RATE_LIMIT', true);
    this.name = 'RateLimitError';
  }
}

export class AuthenticationError extends ProviderError {
  constructor(message: string) {
    super(message, 'AUTHENTICATION', false);
    this.name = 'AuthenticationError';
  }
}

export class TimeoutError extends ProviderError {
  constructor(message: string) {
    super(message, 'TIMEOUT', true);
    this.name = 'TimeoutError';
  }
}

export class InvalidResponseError extends ProviderError {
  constructor(message: string, public readonly response?: unknown) {
    super(message, 'INVALID_RESPONSE', false);
    this.name = 'InvalidResponseError';
  }
}

// ============================================================================
// Rate Limiter
// ============================================================================

interface RateLimitBucket {
  tokens: number;
  lastRefill: number;
}

export class RateLimiter {
  private requestBucket: RateLimitBucket;
  private tokenBucket: RateLimitBucket;
  private readonly requestsPerMinute: number;
  private readonly tokensPerMinute: number;

  constructor(requestsPerMinute = 60, tokensPerMinute = 100000) {
    this.requestsPerMinute = requestsPerMinute;
    this.tokensPerMinute = tokensPerMinute;
    this.requestBucket = { tokens: requestsPerMinute, lastRefill: Date.now() };
    this.tokenBucket = { tokens: tokensPerMinute, lastRefill: Date.now() };
  }

  private refillBucket(bucket: RateLimitBucket, maxTokens: number, refillRate: number): void {
    const now = Date.now();
    const elapsed = now - bucket.lastRefill;
    const tokensToAdd = (elapsed / 60000) * refillRate;
    bucket.tokens = Math.min(maxTokens, bucket.tokens + tokensToAdd);
    bucket.lastRefill = now;
  }

  async waitForCapacity(estimatedTokens = 1000): Promise<void> {
    // Refill buckets
    this.refillBucket(this.requestBucket, this.requestsPerMinute, this.requestsPerMinute);
    this.refillBucket(this.tokenBucket, this.tokensPerMinute, this.tokensPerMinute);

    // Check if we have capacity
    while (this.requestBucket.tokens < 1 || this.tokenBucket.tokens < estimatedTokens) {
      // Calculate wait time
      const requestWait = this.requestBucket.tokens < 1
        ? ((1 - this.requestBucket.tokens) / this.requestsPerMinute) * 60000
        : 0;
      const tokenWait = this.tokenBucket.tokens < estimatedTokens
        ? ((estimatedTokens - this.tokenBucket.tokens) / this.tokensPerMinute) * 60000
        : 0;
      const waitTime = Math.max(requestWait, tokenWait, 100);

      await this.sleep(Math.min(waitTime, 10000));

      // Refill again after waiting
      this.refillBucket(this.requestBucket, this.requestsPerMinute, this.requestsPerMinute);
      this.refillBucket(this.tokenBucket, this.tokensPerMinute, this.tokensPerMinute);
    }

    // Consume tokens
    this.requestBucket.tokens -= 1;
    this.tokenBucket.tokens -= estimatedTokens;
  }

  consumeTokens(actualTokens: number, estimatedTokens: number): void {
    // Adjust for actual usage vs estimated
    const difference = actualTokens - estimatedTokens;
    this.tokenBucket.tokens -= difference;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================================================
// Retry Logic
// ============================================================================

export interface RetryOptions {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  exponentialBase: number;
  jitterFactor: number;
}

const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 60000,
  exponentialBase: 2,
  jitterFactor: 0.1,
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {},
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if error is retryable
      if (error instanceof ProviderError && !error.retryable) {
        throw error;
      }

      // Don't retry on last attempt
      if (attempt === opts.maxRetries) {
        break;
      }

      // Calculate delay with exponential backoff and jitter
      let delay = opts.baseDelay * Math.pow(opts.exponentialBase, attempt);

      // Handle rate limit retry-after
      if (error instanceof RateLimitError && error.retryAfter !== undefined) {
        delay = Math.max(delay, error.retryAfter * 1000);
      }

      // Add jitter
      const jitter = delay * opts.jitterFactor * (Math.random() * 2 - 1);
      delay = Math.min(opts.maxDelay, delay + jitter);

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError ?? new Error('Retry failed with unknown error');
}

// ============================================================================
// Abstract Base Provider
// ============================================================================

export abstract class BaseProvider {
  protected readonly config: Required<ProviderConfig>;
  protected readonly rateLimiter: RateLimiter;

  constructor(config: ProviderConfig = {}) {
    this.config = {
      apiKey: config.apiKey ?? '',
      baseUrl: config.baseUrl ?? '',
      model: config.model ?? '',
      maxTokens: config.maxTokens ?? 4096,
      temperature: config.temperature ?? 0,
      timeout: config.timeout ?? 120000,
      maxRetries: config.maxRetries ?? 3,
      rateLimitRpm: config.rateLimitRpm ?? 60,
      rateLimitTpm: config.rateLimitTpm ?? 100000,
    };

    this.rateLimiter = new RateLimiter(
      this.config.rateLimitRpm,
      this.config.rateLimitTpm,
    );
  }

  /**
   * Get the provider name for logging and identification
   */
  abstract get name(): string;

  /**
   * Analyze code files for quality issues
   */
  abstract analyzeCode(
    files: string[],
    context: string,
    callbacks?: StreamCallbacks,
  ): Promise<AnalysisResult>;

  /**
   * Generate a fix for a specific issue
   */
  abstract fixIssue(
    issue: Issue,
    fileContent: string,
    callbacks?: StreamCallbacks,
  ): Promise<FixResult>;

  /**
   * Verify that a proposed fix is valid and addresses the issue
   */
  abstract verifyFix(
    issue: Issue,
    diff: string,
    fileContent: string,
    callbacks?: StreamCallbacks,
  ): Promise<VerifyResult>;

  // ============================================================================
  // Common Utility Methods
  // ============================================================================

  /**
   * Estimate token count for a string (rough approximation)
   */
  protected estimateTokens(text: string): number {
    // Rough estimate: ~4 characters per token for English text
    // Code tends to have more tokens due to special characters
    return Math.ceil(text.length / 3.5);
  }

  /**
   * Truncate content to fit within token limits
   */
  protected truncateContent(content: string, maxTokens: number): string {
    const estimatedTokens = this.estimateTokens(content);
    if (estimatedTokens <= maxTokens) {
      return content;
    }

    // Truncate to approximately maxTokens
    const ratio = maxTokens / estimatedTokens;
    const targetLength = Math.floor(content.length * ratio * 0.9); // 10% safety margin

    return content.slice(0, targetLength) + '\n\n[Content truncated due to length...]';
  }

  /**
   * Format file content with line numbers for context
   */
  protected formatFileWithLineNumbers(content: string, startLine = 1): string {
    const lines = content.split('\n');
    const lineNumberWidth = String(startLine + lines.length - 1).length;

    return lines
      .map((line, index) => {
        const lineNumber = String(startLine + index).padStart(lineNumberWidth, ' ');
        return `${lineNumber} | ${line}`;
      })
      .join('\n');
  }

  /**
   * Extract code context around a specific location
   */
  protected extractContext(
    content: string,
    location: IssueLocation,
    contextLines = 10,
  ): string {
    const lines = content.split('\n');
    const startLine = Math.max(0, location.startLine - contextLines - 1);
    const endLine = Math.min(lines.length, location.endLine + contextLines);

    const contextContent = lines.slice(startLine, endLine).join('\n');
    return this.formatFileWithLineNumbers(contextContent, startLine + 1);
  }

  /**
   * Generate a unified diff between two strings
   */
  protected generateDiff(original: string, modified: string, filename = 'file'): string {
    const originalLines = original.split('\n');
    const modifiedLines = modified.split('\n');
    const diff: string[] = [];

    diff.push(`--- a/${filename}`);
    diff.push(`+++ b/${filename}`);

    // Simple line-by-line diff
    let i = 0;
    let j = 0;
    let hunkStart = -1;
    let hunkLines: string[] = [];

    const flushHunk = (): void => {
      if (hunkLines.length > 0 && hunkStart !== -1) {
        const originalCount = hunkLines.filter(l => !l.startsWith('+')).length;
        const modifiedCount = hunkLines.filter(l => !l.startsWith('-')).length;
        diff.push(`@@ -${String(hunkStart + 1)},${String(originalCount)} +${String(hunkStart + 1)},${String(modifiedCount)} @@`);
        diff.push(...hunkLines);
        hunkLines = [];
        hunkStart = -1;
      }
    };

    while (i < originalLines.length || j < modifiedLines.length) {
      const origLine = originalLines[i];
      const modLine = modifiedLines[j];

      if (origLine === modLine) {
        if (hunkLines.length > 0) {
          hunkLines.push(` ${origLine}`);
          if (hunkLines.filter(l => l.startsWith('+') || l.startsWith('-')).length === 0) {
            flushHunk();
          }
        }
        i++;
        j++;
      } else {
        if (hunkStart === -1) {
          hunkStart = Math.max(0, i - 3);
          // Add context before
          for (let k = hunkStart; k < i; k++) {
            hunkLines.push(` ${originalLines[k]}`);
          }
        }

        if (origLine !== modifiedLines[j]) {
          hunkLines.push(`-${origLine}`);
          i++;
        }
        if (modLine !== originalLines[i - 1]) {
          hunkLines.push(`+${modLine}`);
          j++;
        }
      }
    }

    flushHunk();

    return diff.join('\n');
  }

  /**
   * Apply a unified diff to content
   */
  protected applyDiff(content: string, diff: string): string {
    const lines = content.split('\n');
    const result: string[] = [];
    let lineIndex = 0;

    // Parse hunks
    const diffLines = diff.split('\n');

    // Find all hunk starts
    const hunks: { oldStart: number; startIdx: number; endIdx: number }[] = [];
    for (let i = 0; i < diffLines.length; i++) {
      const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(diffLines[i]);
      if (match) {
        if (hunks.length > 0) {
          hunks[hunks.length - 1].endIdx = i;
        }
        hunks.push({ oldStart: parseInt(match[1], 10), startIdx: i + 1, endIdx: diffLines.length });
      }
    }

    for (const hunk of hunks) {
      // Copy lines before hunk
      while (lineIndex < hunk.oldStart - 1) {
        if (lineIndex < lines.length) {
          result.push(lines[lineIndex]);
        }
        lineIndex++;
      }

      // Apply hunk
      for (let i = hunk.startIdx; i < hunk.endIdx; i++) {
        const dl = diffLines[i];
        if (dl.startsWith('-') && !dl.startsWith('---')) {
          lineIndex++; // skip removed line
        } else if (dl.startsWith('+') && !dl.startsWith('+++')) {
          result.push(dl.slice(1)); // add new line
        } else if (dl.startsWith(' ')) {
          if (lineIndex < lines.length) {
            result.push(lines[lineIndex]);
          }
          lineIndex++;
        }
      }
    }

    // Copy remaining
    while (lineIndex < lines.length) {
      result.push(lines[lineIndex]);
      lineIndex++;
    }

    return result.join('\n');
  }

  /**
   * Parse JSON from a potentially markdown-wrapped response
   */
  protected parseJsonResponse<T>(response: string, schema: z.ZodSchema<T>): T {
    // Try to extract JSON from markdown code blocks
    let jsonStr = response;

    const codeBlockMatch = /```(?:json)?\s*([\s\S]*?)```/.exec(response);
    if (codeBlockMatch?.[1] !== undefined && codeBlockMatch[1] !== '') {
      jsonStr = codeBlockMatch[1].trim();
    }

    // Try to find JSON object or array
    const jsonMatch = /(\{[\s\S]*\}|\[[\s\S]*\])/.exec(jsonStr);
    if (jsonMatch?.[1] !== undefined && jsonMatch[1] !== '') {
      jsonStr = jsonMatch[1];
    }

    try {
      const parsed: unknown = JSON.parse(jsonStr);
      return schema.parse(parsed);
    } catch (error) {
      throw new InvalidResponseError(
        `Failed to parse response as valid JSON: ${error instanceof Error ? error.message : String(error)}`,
        response,
      );
    }
  }

  /**
   * Validate and sanitize file paths
   */
  protected sanitizeFilePath(filePath: string): string {
    // Remove any path traversal attempts
    return filePath
      .replace(/\.\./g, '')
      .replace(/^\/+/, '')
      .replace(/\/+/g, '/');
  }

  /**
   * Generate a unique issue ID
   */
  protected generateIssueId(file: string, line: number, category: string): string {
    const hash = this.simpleHash(`${file}:${String(line)}:${category}`);
    return `${category.slice(0, 3).toUpperCase()}-${hash}`;
  }

  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(16).slice(0, 8).toUpperCase();
  }

  /**
   * Wrap API call with rate limiting and retry logic
   */
  protected async withRateLimitAndRetry<T>(
    fn: () => Promise<T>,
    estimatedTokens = 1000,
  ): Promise<T> {
    await this.rateLimiter.waitForCapacity(estimatedTokens);

    return withRetry(fn, {
      maxRetries: this.config.maxRetries,
    });
  }
}
