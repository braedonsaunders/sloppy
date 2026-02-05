/**
 * FallbackProvider - Wraps multiple providers with automatic failover.
 * When the primary provider fails due to rate limits or errors,
 * automatically retries with the next available provider.
 */

import {
  BaseProvider,
  RateLimitError,
  ProviderError,
  TimeoutError,
  type StreamCallbacks,
  type AnalysisResult,
  type FixResult,
  type VerifyResult,
  type Issue,
} from './base.js';

export interface FallbackProviderConfig {
  providers: BaseProvider[];
  maxRetriesPerProvider?: number;
  onFallback?: (fromProvider: string, toProvider: string, error: Error) => void;
  onRateLimited?: (provider: string, retryAfterMs: number) => void;
}

interface ProviderHealth {
  provider: BaseProvider;
  failureCount: number;
  lastFailure: number | null;
  rateLimitedUntil: number | null;
  isAvailable: boolean;
}

export class FallbackProvider extends BaseProvider {
  private providerHealth: ProviderHealth[];
  private readonly maxRetriesPerProvider: number;
  private readonly onFallback?: (from: string, to: string, error: Error) => void;
  private readonly onRateLimited?: (provider: string, retryAfterMs: number) => void;

  // Cooldown period after repeated failures (5 minutes)
  private static readonly FAILURE_COOLDOWN_MS = 5 * 60 * 1000;
  // Number of failures before cooling down a provider
  private static readonly MAX_FAILURES_BEFORE_COOLDOWN = 3;

  constructor(config: FallbackProviderConfig) {
    super({});

    if (config.providers.length === 0) {
      throw new ProviderError('FallbackProvider requires at least one provider', 'NO_PROVIDERS', false);
    }

    this.providerHealth = config.providers.map(provider => ({
      provider,
      failureCount: 0,
      lastFailure: null,
      rateLimitedUntil: null,
      isAvailable: true,
    }));

    this.maxRetriesPerProvider = config.maxRetriesPerProvider ?? 1;
    this.onFallback = config.onFallback;
    this.onRateLimited = config.onRateLimited;
  }

  get name(): string {
    const available = this.getAvailableProviders();
    if (available.length === 0) {
      return 'fallback(none)';
    }
    return `fallback(${available[0].provider.name})`;
  }

  get activeProviderName(): string {
    const available = this.getAvailableProviders();
    if (available.length === 0) {
      return 'none';
    }
    return available[0].provider.name;
  }

  get providerCount(): number {
    return this.providerHealth.length;
  }

  get availableProviderCount(): number {
    return this.getAvailableProviders().length;
  }

  async analyzeCode(
    files: string[],
    context: string,
    callbacks?: StreamCallbacks,
  ): Promise<AnalysisResult> {
    return this.withFallback(
      (provider) => provider.analyzeCode(files, context, callbacks),
      'analyzeCode',
    );
  }

  async fixIssue(
    issue: Issue,
    fileContent: string,
    callbacks?: StreamCallbacks,
  ): Promise<FixResult> {
    return this.withFallback(
      (provider) => provider.fixIssue(issue, fileContent, callbacks),
      'fixIssue',
    );
  }

  async verifyFix(
    issue: Issue,
    diff: string,
    fileContent: string,
    callbacks?: StreamCallbacks,
  ): Promise<VerifyResult> {
    return this.withFallback(
      (provider) => provider.verifyFix(issue, diff, fileContent, callbacks),
      'verifyFix',
    );
  }

  /**
   * Execute an operation with automatic fallback across providers.
   */
  private async withFallback<T>(
    operation: (provider: BaseProvider) => Promise<T>,
    operationName: string,
  ): Promise<T> {
    const available = this.getAvailableProviders();

    if (available.length === 0) {
      // Reset cooldowns if all providers are exhausted
      this.resetCooldowns();
      const afterReset = this.getAvailableProviders();
      if (afterReset.length === 0) {
        throw new ProviderError(
          'All providers are unavailable',
          'ALL_PROVIDERS_UNAVAILABLE',
          false,
        );
      }
      return this.withFallback(operation, operationName);
    }

    let lastError: Error | undefined;

    for (const health of available) {
      try {
        const result = await operation(health.provider);
        // Success - reset failure count
        health.failureCount = 0;
        health.lastFailure = null;
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (error instanceof RateLimitError) {
          // Mark as rate limited
          const retryAfterMs = (error.retryAfter ?? 60) * 1000;
          health.rateLimitedUntil = Date.now() + retryAfterMs;
          health.isAvailable = false;

          this.onRateLimited?.(health.provider.name, retryAfterMs);

          // Try next provider
          const nextAvailable = this.getAvailableProviders().find(h => h !== health);
          if (nextAvailable) {
            this.onFallback?.(health.provider.name, nextAvailable.provider.name, error);
          }
          continue;
        }

        if (error instanceof TimeoutError || (error instanceof ProviderError && error.retryable)) {
          health.failureCount++;
          health.lastFailure = Date.now();

          if (health.failureCount >= FallbackProvider.MAX_FAILURES_BEFORE_COOLDOWN) {
            health.isAvailable = false;
          }

          const nextAvailable = this.getAvailableProviders().find(h => h !== health);
          if (nextAvailable) {
            this.onFallback?.(health.provider.name, nextAvailable.provider.name, error);
          }
          continue;
        }

        // Non-retryable error - throw immediately
        throw error;
      }
    }

    throw lastError ?? new ProviderError('All providers failed', 'ALL_PROVIDERS_FAILED', false);
  }

  /**
   * Get providers that are currently available (not rate limited or cooled down).
   */
  private getAvailableProviders(): ProviderHealth[] {
    const now = Date.now();

    return this.providerHealth.filter(health => {
      // Check rate limit expiry
      if (health.rateLimitedUntil !== null && now >= health.rateLimitedUntil) {
        health.rateLimitedUntil = null;
        health.isAvailable = true;
      }

      // Check cooldown expiry
      if (!health.isAvailable && health.lastFailure !== null) {
        if (now - health.lastFailure >= FallbackProvider.FAILURE_COOLDOWN_MS) {
          health.isAvailable = true;
          health.failureCount = 0;
        }
      }

      return health.isAvailable;
    });
  }

  /**
   * Reset all cooldowns (used when all providers are exhausted).
   */
  private resetCooldowns(): void {
    for (const health of this.providerHealth) {
      health.isAvailable = true;
      health.failureCount = 0;
      health.rateLimitedUntil = null;
    }
  }

  /**
   * Get status of all providers.
   */
  getProviderStatus(): {
    name: string;
    available: boolean;
    failureCount: number;
    rateLimitedUntil: number | null;
  }[] {
    return this.providerHealth.map(health => ({
      name: health.provider.name,
      available: health.isAvailable,
      failureCount: health.failureCount,
      rateLimitedUntil: health.rateLimitedUntil,
    }));
  }
}

/**
 * Create a fallback provider from multiple provider configs.
 */
export function createFallbackProvider(
  providers: BaseProvider[],
  options?: Omit<FallbackProviderConfig, 'providers'>,
): FallbackProvider {
  return new FallbackProvider({
    providers,
    ...options,
  });
}
