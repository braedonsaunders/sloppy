/**
 * Sloppy Orchestration Types
 * Core type definitions for the orchestration system
 */

// ============================================================================
// Session Types
// ============================================================================

export type SessionStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'stopped'
  | 'timeout';

export type ControlSignal = 'pause' | 'resume' | 'stop' | null;

export interface Session {
  id: string;
  repositoryId: string;
  repositoryPath: string;
  status: SessionStatus;
  config: SessionConfig;
  branch: string;
  cleaningBranch: string;
  startedAt: Date | null;
  completedAt: Date | null;
  pausedAt: Date | null;
  controlSignal: ControlSignal;
  currentIssueId: string | null;
  totalIssues: number;
  resolvedIssues: number;
  failedIssues: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface SessionConfig {
  timeoutMinutes: number;
  maxRetries: number;
  testCommand: string | null;
  lintCommand: string | null;
  buildCommand: string | null;
  checkpointIntervalMinutes: number;
  aiProvider: string;
  aiModel: string;
  analysisTypes: AnalysisType[];
  excludePatterns: string[];
  commitAfterEachFix: boolean;
  runVerificationAfterEachFix: boolean;
  reAnalysisInterval: number;
  maxReAnalysisCycles: number;
}

export type AnalysisType =
  | 'typescript'
  | 'eslint'
  | 'complexity'
  | 'security'
  | 'performance'
  | 'unused-code'
  | 'code-smells';

// ============================================================================
// Issue Types
// ============================================================================

export type IssueSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type IssueCategory =
  | 'error'
  | 'warning'
  | 'style'
  | 'complexity'
  | 'security'
  | 'performance'
  | 'maintainability';

export type IssueStatus =
  | 'pending'
  | 'in_progress'
  | 'resolved'
  | 'failed'
  | 'skipped';

export interface Issue {
  id: string;
  sessionId: string;
  type: string;
  category: IssueCategory;
  severity: IssueSeverity;
  message: string;
  filePath: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  source: string; // e.g., 'eslint', 'typescript', 'complexity-analyzer'
  rule?: string;
  codeSnippet?: string;
  suggestedFix?: string;
  status: IssueStatus;
  retryCount: number;
  lastError?: string;
  resolvedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface IssueFilter {
  sessionId?: string;
  status?: IssueStatus | IssueStatus[];
  severity?: IssueSeverity | IssueSeverity[];
  category?: IssueCategory | IssueCategory[];
  filePath?: string;
}

// ============================================================================
// Verification Types
// ============================================================================

export type VerificationStatus = 'pass' | 'fail' | 'error' | 'timeout' | 'skipped';

export interface TestResult {
  status: VerificationStatus;
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  duration: number;
  output: string;
  errors: TestError[];
}

export interface TestError {
  testName: string;
  message: string;
  stack?: string;
  filePath?: string;
  line?: number;
}

export interface LintResult {
  status: VerificationStatus;
  errorCount: number;
  warningCount: number;
  fixableErrorCount: number;
  fixableWarningCount: number;
  duration: number;
  output: string;
  errors: LintError[];
}

export interface LintError {
  filePath: string;
  line: number;
  column: number;
  rule: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface BuildResult {
  status: VerificationStatus;
  duration: number;
  output: string;
  errors: BuildError[];
}

export interface BuildError {
  filePath?: string;
  line?: number;
  column?: number;
  message: string;
  code?: string;
}

export interface VerificationResult {
  overall: VerificationStatus;
  tests: TestResult | null;
  lint: LintResult | null;
  build: BuildResult | null;
  duration: number;
  timestamp: Date;
}

export interface VerifyResult {
  success: boolean;
  verification: VerificationResult;
  feedback?: string;
  diagnosticFeedback?: string;
}

// ============================================================================
// Checkpoint Types
// ============================================================================

export interface Checkpoint {
  id: string;
  sessionId: string;
  commitHash: string;
  branch: string;
  description: string;
  issueProgress: {
    total: number;
    resolved: number;
    failed: number;
    pending: number;
  };
  metrics: SessionMetrics | null;
  createdAt: Date;
}

export interface CheckpointRestoreResult {
  success: boolean;
  checkpoint: Checkpoint;
  error?: string;
}

// ============================================================================
// Metrics Types
// ============================================================================

export interface SessionMetrics {
  sessionId: string;
  timestamp: Date;

  // Issue metrics
  totalIssues: number;
  resolvedIssues: number;
  failedIssues: number;
  skippedIssues: number;
  inProgressIssues: number;

  // Timing metrics
  elapsedTimeMs: number;
  averageFixTimeMs: number;

  // Verification metrics
  totalVerifications: number;
  passedVerifications: number;
  failedVerifications: number;

  // Retry metrics
  totalRetries: number;
  successfulRetries: number;

  // Code metrics
  linesAdded: number;
  linesRemoved: number;
  filesModified: number;

  // AI metrics
  aiRequestCount: number;
  aiTokensUsed: number;
  aiCost: number;
}

export interface MetricsDelta {
  current: SessionMetrics;
  previous: SessionMetrics | null;
  changes: Partial<SessionMetrics>;
}

// ============================================================================
// Event Types
// ============================================================================

export type SloppyEventType =
  | 'session:started'
  | 'session:paused'
  | 'session:resumed'
  | 'session:stopped'
  | 'session:completed'
  | 'session:failed'
  | 'session:timeout'
  | 'analysis:started'
  | 'analysis:progress'
  | 'analysis:completed'
  | 'issue:started'
  | 'issue:progress'
  | 'issue:resolved'
  | 'issue:failed'
  | 'issue:skipped'
  | 'verification:started'
  | 'verification:completed'
  | 'checkpoint:created'
  | 'checkpoint:restored'
  | 'metrics:updated'
  | 'error:occurred';

export interface SloppyEventBase {
  type: SloppyEventType;
  sessionId: string;
  timestamp: Date;
}

export interface SessionStartedEvent extends SloppyEventBase {
  type: 'session:started';
  config: SessionConfig;
}

export interface SessionPausedEvent extends SloppyEventBase {
  type: 'session:paused';
  reason?: string;
}

export interface SessionResumedEvent extends SloppyEventBase {
  type: 'session:resumed';
}

export interface SessionStoppedEvent extends SloppyEventBase {
  type: 'session:stopped';
  reason?: string;
}

export interface SessionCompletedEvent extends SloppyEventBase {
  type: 'session:completed';
  summary: SessionSummary;
}

export interface SessionFailedEvent extends SloppyEventBase {
  type: 'session:failed';
  error: string;
}

export interface SessionTimeoutEvent extends SloppyEventBase {
  type: 'session:timeout';
  elapsedMinutes: number;
}

export interface AnalysisStartedEvent extends SloppyEventBase {
  type: 'analysis:started';
  analysisTypes: AnalysisType[];
}

export interface AnalysisProgressEvent extends SloppyEventBase {
  type: 'analysis:progress';
  currentAnalyzer: string;
  progress: number; // 0-100
  issuesFound: number;
}

export interface AnalysisCompletedEvent extends SloppyEventBase {
  type: 'analysis:completed';
  totalIssues: number;
  byCategory: Record<IssueCategory, number>;
  bySeverity: Record<IssueSeverity, number>;
}

export interface IssueStartedEvent extends SloppyEventBase {
  type: 'issue:started';
  issue: Issue;
  attempt: number;
}

export interface IssueProgressEvent extends SloppyEventBase {
  type: 'issue:progress';
  issueId: string;
  step: 'analyzing' | 'generating_fix' | 'applying_fix' | 'verifying';
  message?: string;
}

export interface IssueResolvedEvent extends SloppyEventBase {
  type: 'issue:resolved';
  issue: Issue;
  commitHash: string;
  duration: number;
}

export interface IssueFailedEvent extends SloppyEventBase {
  type: 'issue:failed';
  issue: Issue;
  error: string;
  retryCount: number;
}

export interface IssueSkippedEvent extends SloppyEventBase {
  type: 'issue:skipped';
  issue: Issue;
  reason: string;
}

export interface VerificationStartedEvent extends SloppyEventBase {
  type: 'verification:started';
  issueId?: string;
  types: ('test' | 'lint' | 'build')[];
}

export interface VerificationCompletedEvent extends SloppyEventBase {
  type: 'verification:completed';
  issueId?: string;
  result: VerificationResult;
}

export interface CheckpointCreatedEvent extends SloppyEventBase {
  type: 'checkpoint:created';
  checkpoint: Checkpoint;
}

export interface CheckpointRestoredEvent extends SloppyEventBase {
  type: 'checkpoint:restored';
  checkpoint: Checkpoint;
}

export interface MetricsUpdatedEvent extends SloppyEventBase {
  type: 'metrics:updated';
  metrics: SessionMetrics;
  delta: MetricsDelta;
}

export interface ErrorOccurredEvent extends SloppyEventBase {
  type: 'error:occurred';
  error: string;
  stack?: string;
  recoverable: boolean;
}

export type SloppyEvent =
  | SessionStartedEvent
  | SessionPausedEvent
  | SessionResumedEvent
  | SessionStoppedEvent
  | SessionCompletedEvent
  | SessionFailedEvent
  | SessionTimeoutEvent
  | AnalysisStartedEvent
  | AnalysisProgressEvent
  | AnalysisCompletedEvent
  | IssueStartedEvent
  | IssueProgressEvent
  | IssueResolvedEvent
  | IssueFailedEvent
  | IssueSkippedEvent
  | VerificationStartedEvent
  | VerificationCompletedEvent
  | CheckpointCreatedEvent
  | CheckpointRestoredEvent
  | MetricsUpdatedEvent
  | ErrorOccurredEvent;

// ============================================================================
// Summary Types
// ============================================================================

export interface SessionSummary {
  sessionId: string;
  duration: number;
  totalIssues: number;
  resolvedIssues: number;
  failedIssues: number;
  skippedIssues: number;
  commits: CommitSummary[];
  verificationResults: {
    total: number;
    passed: number;
    failed: number;
  };
  codeChanges: {
    filesModified: number;
    linesAdded: number;
    linesRemoved: number;
  };
  aiUsage: {
    requests: number;
    tokensUsed: number;
    estimatedCost: number;
  };
}

export interface CommitSummary {
  hash: string;
  message: string;
  issueId: string;
  filesChanged: string[];
  timestamp: Date;
}

// ============================================================================
// AI Provider Types
// ============================================================================

export interface FixRequest {
  issue: Issue;
  fileContent: string;
  context: {
    previousAttempts: FixAttempt[];
    verificationErrors?: string;
    relatedFiles?: FileContext[];
    learnings?: string;
    diagnosticPrompt?: string;
  };
}

export interface FixAttempt {
  attempt: number;
  diff: string;
  verificationResult?: VerificationResult;
  feedback?: string;
  diagnosticFeedback?: string;
}

export interface FileContext {
  path: string;
  content: string;
  relevance: string;
}

export interface FixResponse {
  success: boolean;
  diff?: string;
  explanation?: string;
  error?: string;
  tokensUsed?: number;
}

// ============================================================================
// Worker Types
// ============================================================================

export type WorkerMessageType =
  | 'start'
  | 'pause'
  | 'resume'
  | 'stop'
  | 'status'
  | 'event'
  | 'error'
  | 'complete';

export interface WorkerMessage {
  type: WorkerMessageType;
  sessionId: string;
  payload?: unknown;
  timestamp: Date;
}

export interface WorkerStartPayload {
  session: Session;
}

export interface WorkerStatusPayload {
  status: SessionStatus;
  currentIssue: Issue | null;
  progress: {
    total: number;
    resolved: number;
    failed: number;
  };
}

export interface WorkerEventPayload {
  event: SloppyEvent;
}

export interface WorkerErrorPayload {
  error: string;
  stack?: string;
  fatal: boolean;
}

export interface WorkerCompletePayload {
  summary: SessionSummary;
}

// ============================================================================
// Database Types
// ============================================================================

export interface DatabaseSession extends Omit<Session, 'startedAt' | 'completedAt' | 'pausedAt' | 'createdAt' | 'updatedAt'> {
  startedAt: string | null;
  completedAt: string | null;
  pausedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DatabaseIssue extends Omit<Issue, 'resolvedAt' | 'createdAt' | 'updatedAt'> {
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DatabaseCheckpoint extends Omit<Checkpoint, 'createdAt'> {
  createdAt: string;
}

export interface DatabaseMetrics extends Omit<SessionMetrics, 'timestamp'> {
  id: string;
  timestamp: string;
}

// ============================================================================
// Logger Interface
// ============================================================================

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

// ============================================================================
// Learnings Adapter Interface
// ============================================================================

export interface LearningsAdapter {
  saveLearning(learning: {
    sessionId: string;
    category: string;
    pattern: string;
    description: string;
    filePatterns?: string[];
    confidence?: number;
  }): void;
  getLearnings(sessionId: string): Array<{
    pattern: string;
    description: string;
    category: string;
    confidence: number;
  }>;
  getGlobalLearnings(): Array<{
    pattern: string;
    description: string;
    category: string;
    confidence: number;
  }>;
}

// ============================================================================
// Config Types
// ============================================================================

export interface OrchestratorConfig {
  maxConcurrentSessions: number;
  defaultTimeoutMinutes: number;
  defaultMaxRetries: number;
  defaultCheckpointIntervalMinutes: number;
  verificationTimeoutMs: number;
  analysisTimeoutMs: number;
  aiRequestTimeoutMs: number;
}

export const DEFAULT_ORCHESTRATOR_CONFIG: OrchestratorConfig = {
  maxConcurrentSessions: 3,
  defaultTimeoutMinutes: 60,
  defaultMaxRetries: 3,
  defaultCheckpointIntervalMinutes: 10,
  verificationTimeoutMs: 300000, // 5 minutes
  analysisTimeoutMs: 600000, // 10 minutes
  aiRequestTimeoutMs: 120000, // 2 minutes
};
