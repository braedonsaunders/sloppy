/**
 * @sloppy/core
 *
 * Core types and utilities for the Sloppy code quality improvement tool.
 * This package provides shared types and utilities used across all Sloppy packages.
 *
 * @packageDocumentation
 */

// =============================================================================
// Issue Types
// =============================================================================
export {
  IssueType,
  IssueSeverity,
  type IssueStatus,
  type Issue,
  type IssueSummary,
  type IssueFilter,
  type IssueSortOptions,
  ISSUE_TYPE_PRIORITY,
  SEVERITY_PRIORITY,
  calculateIssuePriority,
} from './types/issue.js';

// =============================================================================
// Session Types
// =============================================================================
export {
  SessionStatus,
  type StrictnessLevel,
  type SessionConfig,
  type Session,
  type SessionSummary,
  type CreateSessionOptions,
  DEFAULT_SESSION_CONFIG,
  mergeSessionConfig,
} from './types/session.js';

// =============================================================================
// Commit Types
// =============================================================================
export {
  type Commit,
  type CommitFileChange,
  type CreateCommitOptions,
  type CommitResult,
  type RevertCommitOptions,
  type RevertResult,
  type CommitFilter,
  type CommitSummary,
  formatCommitMessage,
  parseDiffToFileChanges,
} from './types/commit.js';

// =============================================================================
// Metrics Types
// =============================================================================
export {
  type Metrics,
  type MetricsConfig,
  DEFAULT_METRICS_CONFIG,
  type MetricsSummary,
  type MetricsDelta,
  type MetricsTrends,
  calculateMetricsDelta,
  analyzeMetricsTrends,
  formatMetrics,
} from './types/metrics.js';

// =============================================================================
// Provider Types
// =============================================================================
export {
  ProviderType,
  type ProviderConfig,
  type AnalysisResult,
  type FixResult,
  type VerifyResult,
  type Provider,
  type AnalysisContext,
  type FixContext,
  type VerifyContext,
  DEFAULT_PROVIDER_CONFIG,
  RECOMMENDED_MODELS,
  validateProviderConfig,
} from './types/provider.js';

// =============================================================================
// Event Types
// =============================================================================
export {
  EventType,
  type BaseEvent,
  type ConnectedEvent,
  type DisconnectedEvent,
  type ConnectionErrorEvent,
  type SessionStartedEvent,
  type SessionStatusChangedEvent,
  type SessionPausedEvent,
  type SessionResumedEvent,
  type SessionCompletedEvent,
  type SessionFailedEvent,
  type SessionProgressEvent,
  type IssueFoundEvent,
  type IssuesFoundEvent,
  type IssueUpdatedEvent,
  type IssueResolvedEvent,
  type IssueFailedEvent,
  type IssueSkippedEvent,
  type FixStartedEvent,
  type FixProgressEvent,
  type FixCompletedEvent,
  type FixVerifyingEvent,
  type FixVerifiedEvent,
  type FixFailedEvent,
  type CommitCreatedEvent,
  type CommitRevertedEvent,
  type MetricsUpdatedEvent,
  type HealthScoreChangedEvent,
  type AnalysisStartedEvent,
  type AnalysisProgressEvent,
  type AnalysisCompletedEvent,
  type LogEvent,
  type ErrorEvent,
  type WarningEvent,
  type ProviderRequestStartedEvent,
  type ProviderRequestCompletedEvent,
  type ProviderRateLimitedEvent,
  type SloppyEvent,
  type EventHandler,
  type EventSubscriptionOptions,
  createEvent,
  isEventType,
  serializeEvent,
  deserializeEvent,
} from './types/events.js';

// =============================================================================
// Logger Utility
// =============================================================================
export {
  type LogLevel,
  type LoggerOptions,
  type Logger,
  createLogger,
  logger,
  parseLogLevel,
  getLogLevelFromEnv,
  createSilentLogger,
  createTestLogger,
} from './utils/logger.js';

// =============================================================================
// Config Utility
// =============================================================================
export {
  type SloppyConfig,
  CONFIG_FILE_NAMES,
  type ConfigLoadResult,
  ConfigValidationError,
  findConfigFile,
  validateConfig,
  loadConfig,
  mergeWithDefaults,
  getProvider,
  getDefaultProvider,
  createSampleConfig,
} from './utils/config.js';

// =============================================================================
// Diff Utility
// =============================================================================
export {
  type DiffHunk,
  type DiffLine,
  type FileDiff,
  type ParsedDiff,
  type ApplyResult,
  type FormatOptions,
  parseDiff,
  applyDiff,
  formatDiff,
  createDiff,
  getAffectedLineRange,
  diffsEqual,
} from './utils/diff.js';

// =============================================================================
// GitHub Types
// =============================================================================
export {
  type GitHubUser,
  type GitHubRepoOwner,
  type GitHubRepository,
  type GitHubBranch,
  type GitHubAuthConfig,
  type GitHubRepoListResponse,
  type ListRepositoriesOptions,
  type GitHubAuthTestResult,
} from './types/github.js';
