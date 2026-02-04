/**
 * Database class wrapping better-sqlite3
 * Provides CRUD operations for sessions, issues, commits, and metrics
 */

import Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { runMigrations } from './migrations.js';

// Types for database entities
export type SessionStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'stopped';
export type IssueSeverity = 'error' | 'warning' | 'info' | 'hint';
export type IssueStatus = 'detected' | 'in_progress' | 'fixed' | 'approved' | 'rejected' | 'skipped';
export type IssueType = 'lint' | 'type' | 'test' | 'security' | 'performance' | 'style';

export interface Session {
  id: string;
  repo_path: string;
  branch: string;
  status: SessionStatus;
  max_time_minutes: number;
  provider_config: string;
  config: string;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Issue {
  id: string;
  session_id: string;
  type: IssueType;
  severity: IssueSeverity;
  file_path: string;
  line_start: number | null;
  line_end: number | null;
  description: string;
  context: string | null;
  status: IssueStatus;
  fix_content: string | null;
  created_at: string;
  resolved_at: string | null;
  attempts: number;
}

export interface Commit {
  id: string;
  session_id: string;
  issue_id: string | null;
  hash: string;
  message: string;
  diff_content: string | null;
  created_at: string;
  reverted: number;
  reverted_at: string | null;
  revert_hash: string | null;
}

export interface Metric {
  id: string;
  session_id: string;
  timestamp: string;
  total_issues: number;
  resolved_issues: number;
  test_count: number | null;
  tests_passing: number | null;
  lint_errors: number | null;
  type_errors: number | null;
  coverage_percent: number | null;
  custom_metrics: string | null;
}

// Input types for creating entities
export interface CreateSessionInput {
  repo_path: string;
  branch: string;
  max_time_minutes?: number;
  provider_config?: Record<string, unknown>;
  config?: Record<string, unknown>;
}

export interface CreateIssueInput {
  session_id: string;
  type: IssueType;
  severity?: IssueSeverity;
  file_path: string;
  line_start?: number;
  line_end?: number;
  description: string;
  context?: Record<string, unknown>;
}

export interface CreateCommitInput {
  session_id: string;
  issue_id?: string;
  hash: string;
  message: string;
  diff_content?: string;
}

export interface CreateMetricInput {
  session_id: string;
  total_issues: number;
  resolved_issues: number;
  test_count?: number;
  tests_passing?: number;
  lint_errors?: number;
  type_errors?: number;
  coverage_percent?: number;
  custom_metrics?: Record<string, unknown>;
}

export interface UpdateSessionInput {
  status?: SessionStatus;
  started_at?: string;
  ended_at?: string;
  provider_config?: Record<string, unknown>;
  config?: Record<string, unknown>;
}

export interface UpdateIssueInput {
  status?: IssueStatus;
  fix_content?: string | null;
  resolved_at?: string | null;
  attempts?: number;
}

export interface DatabaseOptions {
  path: string;
  logger?: Console;
}

/**
 * Database wrapper class with CRUD operations
 */
export class SloppyDatabase {
  private db: Database.Database;
  private logger: Console;
  private statements: Map<string, Database.Statement> = new Map();

  constructor(options: DatabaseOptions) {
    this.logger = options.logger ?? console;

    // Ensure parent directory exists
    const dbDir = dirname(options.path);
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
      this.logger.info(`[database] Created directory ${dbDir}`);
    }

    this.db = new Database(options.path);

    // Enable WAL mode for better concurrent access
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    this.logger.info(`[database] Connected to ${options.path}`);
  }

  /**
   * Initialize database with migrations
   */
  init(): void {
    runMigrations(this.db, this.logger);
    this.prepareStatements();
    this.logger.info('[database] Initialized');
  }

  /**
   * Prepare commonly used statements for performance
   */
  private prepareStatements(): void {
    // Session statements
    this.statements.set(
      'insertSession',
      this.db.prepare(`
        INSERT INTO sessions (id, repo_path, branch, status, max_time_minutes, provider_config, config)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
    );

    this.statements.set(
      'getSession',
      this.db.prepare('SELECT * FROM sessions WHERE id = ?')
    );

    this.statements.set(
      'listSessions',
      this.db.prepare('SELECT * FROM sessions ORDER BY created_at DESC')
    );

    this.statements.set(
      'listSessionsByStatus',
      this.db.prepare('SELECT * FROM sessions WHERE status = ? ORDER BY created_at DESC')
    );

    this.statements.set(
      'deleteSession',
      this.db.prepare('DELETE FROM sessions WHERE id = ?')
    );

    // Issue statements
    this.statements.set(
      'insertIssue',
      this.db.prepare(`
        INSERT INTO issues (id, session_id, type, severity, file_path, line_start, line_end, description, context)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
    );

    this.statements.set(
      'getIssue',
      this.db.prepare('SELECT * FROM issues WHERE id = ?')
    );

    this.statements.set(
      'listIssuesBySession',
      this.db.prepare('SELECT * FROM issues WHERE session_id = ? ORDER BY created_at DESC')
    );

    this.statements.set(
      'listIssuesByStatus',
      this.db.prepare('SELECT * FROM issues WHERE session_id = ? AND status = ? ORDER BY created_at DESC')
    );

    this.statements.set(
      'deleteIssue',
      this.db.prepare('DELETE FROM issues WHERE id = ?')
    );

    // Commit statements
    this.statements.set(
      'insertCommit',
      this.db.prepare(`
        INSERT INTO commits (id, session_id, issue_id, hash, message, diff_content)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
    );

    this.statements.set(
      'getCommit',
      this.db.prepare('SELECT * FROM commits WHERE id = ?')
    );

    this.statements.set(
      'getCommitByHash',
      this.db.prepare('SELECT * FROM commits WHERE hash = ?')
    );

    this.statements.set(
      'listCommitsBySession',
      this.db.prepare('SELECT * FROM commits WHERE session_id = ? ORDER BY created_at DESC')
    );

    this.statements.set(
      'listNonRevertedCommitsBySession',
      this.db.prepare('SELECT * FROM commits WHERE session_id = ? AND reverted = 0 ORDER BY created_at DESC')
    );

    this.statements.set(
      'deleteCommit',
      this.db.prepare('DELETE FROM commits WHERE id = ?')
    );

    // Metric statements
    this.statements.set(
      'insertMetric',
      this.db.prepare(`
        INSERT INTO metrics (id, session_id, total_issues, resolved_issues, test_count, tests_passing, lint_errors, type_errors, coverage_percent, custom_metrics)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
    );

    this.statements.set(
      'getMetric',
      this.db.prepare('SELECT * FROM metrics WHERE id = ?')
    );

    this.statements.set(
      'listMetricsBySession',
      this.db.prepare('SELECT * FROM metrics WHERE session_id = ? ORDER BY timestamp ASC')
    );

    this.statements.set(
      'getLatestMetric',
      this.db.prepare('SELECT * FROM metrics WHERE session_id = ? ORDER BY timestamp DESC LIMIT 1')
    );
  }

  /**
   * Get a prepared statement
   */
  private stmt(name: string): Database.Statement {
    const statement = this.statements.get(name);
    if (!statement) {
      throw new Error(`Prepared statement not found: ${name}`);
    }
    return statement;
  }

  /**
   * Run operations in a transaction
   */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
    this.logger.info('[database] Connection closed');
  }

  // ==================== Session CRUD ====================

  createSession(input: CreateSessionInput): Session {
    const id = nanoid();
    const providerConfig = JSON.stringify(input.provider_config ?? {});
    const config = JSON.stringify(input.config ?? {});

    this.stmt('insertSession').run(
      id,
      input.repo_path,
      input.branch,
      'pending',
      input.max_time_minutes ?? 60,
      providerConfig,
      config
    );

    return this.getSession(id)!;
  }

  getSession(id: string): Session | null {
    return this.stmt('getSession').get(id) as Session | null;
  }

  listSessions(status?: SessionStatus): Session[] {
    if (status) {
      return this.stmt('listSessionsByStatus').all(status) as Session[];
    }
    return this.stmt('listSessions').all() as Session[];
  }

  updateSession(id: string, input: UpdateSessionInput): Session | null {
    const session = this.getSession(id);
    if (!session) return null;

    const updates: string[] = [];
    const values: unknown[] = [];

    if (input.status !== undefined) {
      updates.push('status = ?');
      values.push(input.status);
    }
    if (input.started_at !== undefined) {
      updates.push('started_at = ?');
      values.push(input.started_at);
    }
    if (input.ended_at !== undefined) {
      updates.push('ended_at = ?');
      values.push(input.ended_at);
    }
    if (input.provider_config !== undefined) {
      updates.push('provider_config = ?');
      values.push(JSON.stringify(input.provider_config));
    }
    if (input.config !== undefined) {
      updates.push('config = ?');
      values.push(JSON.stringify(input.config));
    }

    if (updates.length === 0) return session;

    values.push(id);
    const sql = `UPDATE sessions SET ${updates.join(', ')} WHERE id = ?`;
    this.db.prepare(sql).run(...values);

    return this.getSession(id);
  }

  deleteSession(id: string): boolean {
    const result = this.stmt('deleteSession').run(id);
    return result.changes > 0;
  }

  // ==================== Issue CRUD ====================

  createIssue(input: CreateIssueInput): Issue {
    const id = nanoid();
    const context = input.context ? JSON.stringify(input.context) : null;

    this.stmt('insertIssue').run(
      id,
      input.session_id,
      input.type,
      input.severity ?? 'warning',
      input.file_path,
      input.line_start ?? null,
      input.line_end ?? null,
      input.description,
      context
    );

    return this.getIssue(id)!;
  }

  getIssue(id: string): Issue | null {
    return this.stmt('getIssue').get(id) as Issue | null;
  }

  listIssuesBySession(sessionId: string, status?: IssueStatus): Issue[] {
    if (status) {
      return this.stmt('listIssuesByStatus').all(sessionId, status) as Issue[];
    }
    return this.stmt('listIssuesBySession').all(sessionId) as Issue[];
  }

  updateIssue(id: string, input: UpdateIssueInput): Issue | null {
    const issue = this.getIssue(id);
    if (!issue) return null;

    const updates: string[] = [];
    const values: unknown[] = [];

    if (input.status !== undefined) {
      updates.push('status = ?');
      values.push(input.status);
    }
    if (input.fix_content !== undefined) {
      updates.push('fix_content = ?');
      values.push(input.fix_content);
    }
    if (input.resolved_at !== undefined) {
      updates.push('resolved_at = ?');
      values.push(input.resolved_at);
    }
    if (input.attempts !== undefined) {
      updates.push('attempts = ?');
      values.push(input.attempts);
    }

    if (updates.length === 0) return issue;

    values.push(id);
    const sql = `UPDATE issues SET ${updates.join(', ')} WHERE id = ?`;
    this.db.prepare(sql).run(...values);

    return this.getIssue(id);
  }

  incrementIssueAttempts(id: string): Issue | null {
    const issue = this.getIssue(id);
    if (!issue) return null;

    this.db.prepare('UPDATE issues SET attempts = attempts + 1 WHERE id = ?').run(id);
    return this.getIssue(id);
  }

  deleteIssue(id: string): boolean {
    const result = this.stmt('deleteIssue').run(id);
    return result.changes > 0;
  }

  // ==================== Commit CRUD ====================

  createCommit(input: CreateCommitInput): Commit {
    const id = nanoid();

    this.stmt('insertCommit').run(
      id,
      input.session_id,
      input.issue_id ?? null,
      input.hash,
      input.message,
      input.diff_content ?? null
    );

    return this.getCommit(id)!;
  }

  getCommit(id: string): Commit | null {
    return this.stmt('getCommit').get(id) as Commit | null;
  }

  getCommitByHash(hash: string): Commit | null {
    return this.stmt('getCommitByHash').get(hash) as Commit | null;
  }

  listCommitsBySession(sessionId: string, includeReverted = true): Commit[] {
    if (includeReverted) {
      return this.stmt('listCommitsBySession').all(sessionId) as Commit[];
    }
    return this.stmt('listNonRevertedCommitsBySession').all(sessionId) as Commit[];
  }

  markCommitReverted(id: string, revertHash: string): Commit | null {
    const commit = this.getCommit(id);
    if (!commit) return null;

    this.db.prepare(`
      UPDATE commits SET reverted = 1, reverted_at = datetime('now'), revert_hash = ?
      WHERE id = ?
    `).run(revertHash, id);

    return this.getCommit(id);
  }

  deleteCommit(id: string): boolean {
    const result = this.stmt('deleteCommit').run(id);
    return result.changes > 0;
  }

  // ==================== Metric CRUD ====================

  createMetric(input: CreateMetricInput): Metric {
    const id = nanoid();
    const customMetrics = input.custom_metrics ? JSON.stringify(input.custom_metrics) : null;

    this.stmt('insertMetric').run(
      id,
      input.session_id,
      input.total_issues,
      input.resolved_issues,
      input.test_count ?? null,
      input.tests_passing ?? null,
      input.lint_errors ?? null,
      input.type_errors ?? null,
      input.coverage_percent ?? null,
      customMetrics
    );

    return this.getMetric(id)!;
  }

  getMetric(id: string): Metric | null {
    return this.stmt('getMetric').get(id) as Metric | null;
  }

  listMetricsBySession(sessionId: string): Metric[] {
    return this.stmt('listMetricsBySession').all(sessionId) as Metric[];
  }

  getLatestMetric(sessionId: string): Metric | null {
    return this.stmt('getLatestMetric').get(sessionId) as Metric | null;
  }

  // ==================== Utility Methods ====================

  /**
   * Get session statistics
   */
  getSessionStats(sessionId: string): {
    totalIssues: number;
    resolvedIssues: number;
    totalCommits: number;
    revertedCommits: number;
  } {
    const issueStats = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status IN ('fixed', 'approved') THEN 1 ELSE 0 END) as resolved
      FROM issues WHERE session_id = ?
    `).get(sessionId) as { total: number; resolved: number };

    const commitStats = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN reverted = 1 THEN 1 ELSE 0 END) as reverted
      FROM commits WHERE session_id = ?
    `).get(sessionId) as { total: number; reverted: number };

    return {
      totalIssues: issueStats.total,
      resolvedIssues: issueStats.resolved,
      totalCommits: commitStats.total,
      revertedCommits: commitStats.reverted,
    };
  }

  /**
   * Get raw database instance for advanced operations
   */
  getRawDb(): Database.Database {
    return this.db;
  }
}

// Export singleton factory
let dbInstance: SloppyDatabase | null = null;

export function getDatabase(options?: DatabaseOptions): SloppyDatabase {
  if (!dbInstance) {
    if (!options) {
      throw new Error('Database not initialized. Provide options on first call.');
    }
    dbInstance = new SloppyDatabase(options);
    dbInstance.init();
  }
  return dbInstance;
}

export function closeDatabase(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
