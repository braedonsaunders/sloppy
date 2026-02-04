/**
 * Event Types and Interfaces
 *
 * Defines WebSocket event types for real-time communication between
 * the Sloppy server and UI clients.
 */

import { randomUUID } from 'node:crypto';
import type { Issue, IssueSummary } from './issue.js';
import type { Session, SessionStatus, SessionSummary } from './session.js';
import type { Commit } from './commit.js';
import type { Metrics, MetricsTrends } from './metrics.js';

/**
 * All WebSocket event types.
 */
export enum EventType {
  // Connection events
  /** Client connected to server */
  CONNECTED = 'CONNECTED',
  /** Client disconnected from server */
  DISCONNECTED = 'DISCONNECTED',
  /** Connection error occurred */
  CONNECTION_ERROR = 'CONNECTION_ERROR',

  // Session events
  /** New session started */
  SESSION_STARTED = 'SESSION_STARTED',
  /** Session status changed */
  SESSION_STATUS_CHANGED = 'SESSION_STATUS_CHANGED',
  /** Session paused */
  SESSION_PAUSED = 'SESSION_PAUSED',
  /** Session resumed */
  SESSION_RESUMED = 'SESSION_RESUMED',
  /** Session completed */
  SESSION_COMPLETED = 'SESSION_COMPLETED',
  /** Session failed */
  SESSION_FAILED = 'SESSION_FAILED',
  /** Session progress update */
  SESSION_PROGRESS = 'SESSION_PROGRESS',

  // Issue events
  /** New issue found during analysis */
  ISSUE_FOUND = 'ISSUE_FOUND',
  /** Multiple issues found (batch) */
  ISSUES_FOUND = 'ISSUES_FOUND',
  /** Issue status updated */
  ISSUE_UPDATED = 'ISSUE_UPDATED',
  /** Issue resolved successfully */
  ISSUE_RESOLVED = 'ISSUE_RESOLVED',
  /** Issue fix failed */
  ISSUE_FAILED = 'ISSUE_FAILED',
  /** Issue skipped */
  ISSUE_SKIPPED = 'ISSUE_SKIPPED',

  // Fix events
  /** Starting to fix an issue */
  FIX_STARTED = 'FIX_STARTED',
  /** Fix attempt in progress */
  FIX_PROGRESS = 'FIX_PROGRESS',
  /** Fix completed successfully */
  FIX_COMPLETED = 'FIX_COMPLETED',
  /** Fix verification started */
  FIX_VERIFYING = 'FIX_VERIFYING',
  /** Fix verification completed */
  FIX_VERIFIED = 'FIX_VERIFIED',
  /** Fix failed */
  FIX_FAILED = 'FIX_FAILED',

  // Commit events
  /** Commit created */
  COMMIT_CREATED = 'COMMIT_CREATED',
  /** Commit reverted */
  COMMIT_REVERTED = 'COMMIT_REVERTED',

  // Metrics events
  /** Metrics updated */
  METRICS_UPDATED = 'METRICS_UPDATED',
  /** Health score changed */
  HEALTH_SCORE_CHANGED = 'HEALTH_SCORE_CHANGED',

  // Analysis events
  /** Analysis phase started */
  ANALYSIS_STARTED = 'ANALYSIS_STARTED',
  /** Analysis progress update */
  ANALYSIS_PROGRESS = 'ANALYSIS_PROGRESS',
  /** Analysis phase completed */
  ANALYSIS_COMPLETED = 'ANALYSIS_COMPLETED',

  // Log events
  /** Log message */
  LOG = 'LOG',
  /** Error message */
  ERROR = 'ERROR',
  /** Warning message */
  WARNING = 'WARNING',

  // Provider events
  /** Provider request started */
  PROVIDER_REQUEST_STARTED = 'PROVIDER_REQUEST_STARTED',
  /** Provider request completed */
  PROVIDER_REQUEST_COMPLETED = 'PROVIDER_REQUEST_COMPLETED',
  /** Provider rate limited */
  PROVIDER_RATE_LIMITED = 'PROVIDER_RATE_LIMITED',
}

/**
 * Base event interface that all events extend.
 */
export interface BaseEvent {
  /**
   * Unique event ID.
   */
  id: string;

  /**
   * Event type.
   */
  type: EventType;

  /**
   * Timestamp when the event occurred.
   */
  timestamp: Date;

  /**
   * Session ID this event belongs to (if applicable).
   */
  sessionId?: string;
}

// Connection events

export interface ConnectedEvent extends BaseEvent {
  type: EventType.CONNECTED;
  clientId: string;
}

export interface DisconnectedEvent extends BaseEvent {
  type: EventType.DISCONNECTED;
  clientId: string;
  reason?: string;
}

export interface ConnectionErrorEvent extends BaseEvent {
  type: EventType.CONNECTION_ERROR;
  error: string;
  code?: string;
}

// Session events

export interface SessionStartedEvent extends BaseEvent {
  type: EventType.SESSION_STARTED;
  session: Session;
}

export interface SessionStatusChangedEvent extends BaseEvent {
  type: EventType.SESSION_STATUS_CHANGED;
  sessionId: string;
  previousStatus: SessionStatus;
  newStatus: SessionStatus;
}

export interface SessionPausedEvent extends BaseEvent {
  type: EventType.SESSION_PAUSED;
  sessionId: string;
  reason?: string;
}

export interface SessionResumedEvent extends BaseEvent {
  type: EventType.SESSION_RESUMED;
  sessionId: string;
}

export interface SessionCompletedEvent extends BaseEvent {
  type: EventType.SESSION_COMPLETED;
  sessionId: string;
  summary: SessionSummary;
}

export interface SessionFailedEvent extends BaseEvent {
  type: EventType.SESSION_FAILED;
  sessionId: string;
  error: string;
  summary?: SessionSummary;
}

export interface SessionProgressEvent extends BaseEvent {
  type: EventType.SESSION_PROGRESS;
  sessionId: string;
  progress: {
    phase: 'analyzing' | 'cleaning' | 'verifying';
    current: number;
    total: number;
    message?: string;
  };
}

// Issue events

export interface IssueFoundEvent extends BaseEvent {
  type: EventType.ISSUE_FOUND;
  issue: Issue;
}

export interface IssuesFoundEvent extends BaseEvent {
  type: EventType.ISSUES_FOUND;
  issues: Issue[];
  summary: IssueSummary;
}

export interface IssueUpdatedEvent extends BaseEvent {
  type: EventType.ISSUE_UPDATED;
  issue: Issue;
  changes: Partial<Issue>;
}

export interface IssueResolvedEvent extends BaseEvent {
  type: EventType.ISSUE_RESOLVED;
  issue: Issue;
  commitId?: string;
}

export interface IssueFailedEvent extends BaseEvent {
  type: EventType.ISSUE_FAILED;
  issue: Issue;
  error: string;
  attempts: number;
}

export interface IssueSkippedEvent extends BaseEvent {
  type: EventType.ISSUE_SKIPPED;
  issue: Issue;
  reason: string;
}

// Fix events

export interface FixStartedEvent extends BaseEvent {
  type: EventType.FIX_STARTED;
  issueId: string;
  attempt: number;
}

export interface FixProgressEvent extends BaseEvent {
  type: EventType.FIX_PROGRESS;
  issueId: string;
  message: string;
  progress?: number;
}

export interface FixCompletedEvent extends BaseEvent {
  type: EventType.FIX_COMPLETED;
  issueId: string;
  diff: string;
  explanation?: string;
}

export interface FixVerifyingEvent extends BaseEvent {
  type: EventType.FIX_VERIFYING;
  issueId: string;
  checks: ('tests' | 'lint' | 'types' | 'build')[];
}

export interface FixVerifiedEvent extends BaseEvent {
  type: EventType.FIX_VERIFIED;
  issueId: string;
  results: {
    tests?: { passed: boolean; output?: string };
    lint?: { passed: boolean; errors?: number };
    types?: { passed: boolean; errors?: number };
    build?: { passed: boolean; output?: string };
  };
}

export interface FixFailedEvent extends BaseEvent {
  type: EventType.FIX_FAILED;
  issueId: string;
  error: string;
  phase: 'generation' | 'application' | 'verification';
}

// Commit events

export interface CommitCreatedEvent extends BaseEvent {
  type: EventType.COMMIT_CREATED;
  commit: Commit;
}

export interface CommitRevertedEvent extends BaseEvent {
  type: EventType.COMMIT_REVERTED;
  commitId: string;
  revertHash: string;
  reason: string;
}

// Metrics events

export interface MetricsUpdatedEvent extends BaseEvent {
  type: EventType.METRICS_UPDATED;
  metrics: Metrics;
}

export interface HealthScoreChangedEvent extends BaseEvent {
  type: EventType.HEALTH_SCORE_CHANGED;
  sessionId: string;
  previousScore: number;
  newScore: number;
  trends: MetricsTrends;
}

// Analysis events

export interface AnalysisStartedEvent extends BaseEvent {
  type: EventType.ANALYSIS_STARTED;
  sessionId: string;
  totalFiles: number;
}

export interface AnalysisProgressEvent extends BaseEvent {
  type: EventType.ANALYSIS_PROGRESS;
  sessionId: string;
  filesAnalyzed: number;
  totalFiles: number;
  currentFile?: string;
}

export interface AnalysisCompletedEvent extends BaseEvent {
  type: EventType.ANALYSIS_COMPLETED;
  sessionId: string;
  summary: IssueSummary;
  durationMs: number;
}

// Log events

export interface LogEvent extends BaseEvent {
  type: EventType.LOG;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  data?: Record<string, unknown>;
}

export interface ErrorEvent extends BaseEvent {
  type: EventType.ERROR;
  error: string;
  stack?: string;
  context?: Record<string, unknown>;
}

export interface WarningEvent extends BaseEvent {
  type: EventType.WARNING;
  message: string;
  context?: Record<string, unknown>;
}

// Provider events

export interface ProviderRequestStartedEvent extends BaseEvent {
  type: EventType.PROVIDER_REQUEST_STARTED;
  providerId: string;
  requestType: 'analyze' | 'fix' | 'verify';
}

export interface ProviderRequestCompletedEvent extends BaseEvent {
  type: EventType.PROVIDER_REQUEST_COMPLETED;
  providerId: string;
  requestType: 'analyze' | 'fix' | 'verify';
  durationMs: number;
  tokensUsed?: number;
}

export interface ProviderRateLimitedEvent extends BaseEvent {
  type: EventType.PROVIDER_RATE_LIMITED;
  providerId: string;
  retryAfterMs: number;
}

/**
 * Union type of all possible events.
 */
export type SloppyEvent =
  | ConnectedEvent
  | DisconnectedEvent
  | ConnectionErrorEvent
  | SessionStartedEvent
  | SessionStatusChangedEvent
  | SessionPausedEvent
  | SessionResumedEvent
  | SessionCompletedEvent
  | SessionFailedEvent
  | SessionProgressEvent
  | IssueFoundEvent
  | IssuesFoundEvent
  | IssueUpdatedEvent
  | IssueResolvedEvent
  | IssueFailedEvent
  | IssueSkippedEvent
  | FixStartedEvent
  | FixProgressEvent
  | FixCompletedEvent
  | FixVerifyingEvent
  | FixVerifiedEvent
  | FixFailedEvent
  | CommitCreatedEvent
  | CommitRevertedEvent
  | MetricsUpdatedEvent
  | HealthScoreChangedEvent
  | AnalysisStartedEvent
  | AnalysisProgressEvent
  | AnalysisCompletedEvent
  | LogEvent
  | ErrorEvent
  | WarningEvent
  | ProviderRequestStartedEvent
  | ProviderRequestCompletedEvent
  | ProviderRateLimitedEvent;

/**
 * Event handler function type.
 */
export type EventHandler<T extends SloppyEvent = SloppyEvent> = (
  event: T
) => void | Promise<void>;

/**
 * Event subscription options.
 */
export interface EventSubscriptionOptions {
  /**
   * Filter events by session ID.
   */
  sessionId?: string;

  /**
   * Filter events by type.
   */
  types?: EventType[];

  /**
   * Whether to receive historical events.
   */
  includeHistory?: boolean;
}

/**
 * Create a new event with auto-generated ID and timestamp.
 *
 * @param type - Event type
 * @param data - Event data (excluding id, type, timestamp)
 * @returns Complete event object
 */
export function createEvent<T extends SloppyEvent>(
  type: T['type'],
  data: Omit<T, 'id' | 'type' | 'timestamp'>
): T {
  return {
    id: randomUUID(),
    type,
    timestamp: new Date(),
    ...data,
  } as T;
}

/**
 * Type guard to check if an event is of a specific type.
 *
 * @param event - Event to check
 * @param type - Expected event type
 * @returns True if event matches the type
 */
export function isEventType<T extends SloppyEvent>(
  event: SloppyEvent,
  type: T['type']
): event is T {
  return event.type === type;
}

/**
 * Serialize an event for transmission.
 *
 * @param event - Event to serialize
 * @returns JSON string
 */
export function serializeEvent(event: SloppyEvent): string {
  return JSON.stringify(event, (_key, value: unknown) => {
    if (value instanceof Date) {
      return value.toISOString();
    }
    return value;
  });
}

/**
 * Deserialize an event from JSON.
 *
 * @param json - JSON string
 * @returns Parsed event
 */
export function deserializeEvent(json: string): SloppyEvent {
  return JSON.parse(json, (key, value: unknown) => {
    if (key === 'timestamp' || key.endsWith('At')) {
      return new Date(value as string | number | Date);
    }
    return value;
  }) as SloppyEvent;
}
