/**
 * Sloppy Services - Main exports
 * This file exports all services and types for the orchestration system
 */

// Types
export * from './types';

// Event Emitter
export {
  SloppyEventEmitter,
  EventHandler,
  EventSubscription,
  WebSocketClient,
  createEventEmitter,
  getGlobalEventEmitter,
  resetGlobalEventEmitter,
} from './event-emitter';

// Verification Service
export {
  VerificationService,
  VerificationOptions,
  createVerificationService,
  formatVerificationResult,
  extractVerificationErrors,
} from './verification';

// Issue Tracker
export {
  IssueTracker,
  IssueStats,
  IssueUpdate,
  DatabaseAdapter as IssueDatabaseAdapter,
  createIssueTracker,
  InMemoryDatabaseAdapter as InMemoryIssueDatabaseAdapter,
} from './issue-tracker';

// Checkpoint Service
export {
  CheckpointService,
  CheckpointServiceConfig,
  CheckpointDatabaseAdapter,
  createCheckpointService,
  InMemoryCheckpointDatabaseAdapter,
} from './checkpoint';

// Metrics Collector
export {
  MetricsCollector,
  MetricsCollectorConfig,
  MetricsDatabaseAdapter,
  createMetricsCollector,
  InMemoryMetricsDatabaseAdapter,
  formatMetricsSummary,
  calculateSuccessRate,
  calculateCompletionRate,
} from './metrics-collector';

// Orchestrator
export {
  Orchestrator,
  OrchestratorDependencies,
  AIProvider,
  CodeAnalyzer,
  SessionDatabaseAdapter,
  createOrchestrator,
} from './orchestrator';
