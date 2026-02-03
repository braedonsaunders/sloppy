/**
 * Database exports
 */

export {
  SloppyDatabase,
  getDatabase,
  closeDatabase,
} from './database.js';

export type {
  Session,
  Issue,
  Commit,
  Metric,
  SessionStatus,
  IssueStatus,
  IssueSeverity,
  IssueType,
  CreateSessionInput,
  CreateIssueInput,
  CreateCommitInput,
  CreateMetricInput,
  UpdateSessionInput,
  UpdateIssueInput,
  DatabaseOptions,
} from './database.js';

export { runMigrations, addMigration, resetMigrations } from './migrations.js';
