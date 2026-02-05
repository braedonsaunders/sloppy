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

// Learnings types
export type LearningCategory = 'general' | 'bug-pattern' | 'security' | 'performance' | 'style' | 'testing';

export interface Learning {
  id: string;
  session_id: string | null;
  category: LearningCategory;
  pattern: string;
  description: string;
  file_patterns: string | null;
  confidence: number;
  times_applied: number;
  last_applied_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateLearningInput {
  session_id?: string;
  category?: LearningCategory;
  pattern: string;
  description: string;
  file_patterns?: string[];
  confidence?: number;
}

export interface UpdateLearningInput {
  confidence?: number;
  times_applied?: number;
  last_applied_at?: string;
}

// Analysis progress types
export interface AnalysisProgress {
  id: string;
  session_id: string;
  iteration: number;
  files_analyzed: number;
  files_total: number;
  issues_found: number;
  issues_fixed: number;
  state: string;
  started_at: string;
  updated_at: string;
}

export interface CreateAnalysisProgressInput {
  session_id: string;
  files_total: number;
  state?: Record<string, unknown>;
}

export interface UpdateAnalysisProgressInput {
  iteration?: number;
  files_analyzed?: number;
  issues_found?: number;
  issues_fixed?: number;
  state?: Record<string, unknown>;
}

// Score types
export interface Score {
  id: string;
  session_id: string;
  score: number;
  breakdown: string;
  issues_before: number;
  issues_after: number;
  computed_at: string;
}

export interface CreateScoreInput {
  session_id: string;
  score: number;
  breakdown: Record<string, number>;
  issues_before: number;
  issues_after: number;
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

    // Score statements
    this.statements.set(
      'insertScore',
      this.db.prepare(`
        INSERT INTO scores (id, session_id, score, breakdown, issues_before, issues_after)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
    );

    this.statements.set(
      'getScore',
      this.db.prepare('SELECT * FROM scores WHERE id = ?')
    );

    this.statements.set(
      'getLatestScore',
      this.db.prepare('SELECT * FROM scores WHERE session_id = ? ORDER BY computed_at DESC LIMIT 1')
    );

    this.statements.set(
      'listScoresBySession',
      this.db.prepare('SELECT * FROM scores WHERE session_id = ? ORDER BY computed_at DESC')
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

  // ==================== Score CRUD ====================

  createScore(input: CreateScoreInput): Score {
    const id = nanoid();
    const breakdown = JSON.stringify(input.breakdown);

    this.stmt('insertScore').run(
      id,
      input.session_id,
      input.score,
      breakdown,
      input.issues_before,
      input.issues_after
    );

    return this.getScore(id)!;
  }

  getScore(id: string): Score | null {
    return this.stmt('getScore').get(id) as Score | null;
  }

  getLatestScore(sessionId: string): Score | null {
    return this.stmt('getLatestScore').get(sessionId) as Score | null;
  }

  listScoresBySession(sessionId: string): Score[] {
    return this.stmt('listScoresBySession').all(sessionId) as Score[];
  }

  // ==================== Utility Methods ====================

  /**
   * Get session statistics
   */
  getSessionStats(sessionId: string): {
    issuesFound: number;
    issuesResolved: number;
    commitsCreated: number;
    revertedCommits: number;
    elapsedTime: number;
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

    // Calculate elapsed time from session start
    const session = this.getSession(sessionId);
    let elapsedTime = 0;
    if (session?.started_at) {
      const startTime = new Date(session.started_at).getTime();
      const endTime = session.ended_at ? new Date(session.ended_at).getTime() : Date.now();
      elapsedTime = Math.floor((endTime - startTime) / 1000); // in seconds
    }

    return {
      issuesFound: issueStats.total,
      issuesResolved: issueStats.resolved,
      commitsCreated: commitStats.total,
      revertedCommits: commitStats.reverted,
      elapsedTime,
    };
  }

  /**
   * Get raw database instance for advanced operations
   */
  getRawDb(): Database.Database {
    return this.db;
  }

  // ==================== Learning CRUD ====================

  createLearning(input: CreateLearningInput): Learning {
    const id = nanoid();
    const filePatterns = input.file_patterns ? JSON.stringify(input.file_patterns) : null;

    this.db.prepare(`
      INSERT INTO learnings (id, session_id, category, pattern, description, file_patterns, confidence)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.session_id ?? null,
      input.category ?? 'general',
      input.pattern,
      input.description,
      filePatterns,
      input.confidence ?? 0.8
    );

    return this.getLearning(id)!;
  }

  getLearning(id: string): Learning | null {
    return this.db.prepare('SELECT * FROM learnings WHERE id = ?').get(id) as Learning | null;
  }

  listLearnings(sessionId?: string): Learning[] {
    if (sessionId) {
      return this.db.prepare('SELECT * FROM learnings WHERE session_id = ? ORDER BY created_at DESC').all(sessionId) as Learning[];
    }
    return this.db.prepare('SELECT * FROM learnings ORDER BY times_applied DESC, created_at DESC').all() as Learning[];
  }

  listLearningsByCategory(category: LearningCategory): Learning[] {
    return this.db.prepare('SELECT * FROM learnings WHERE category = ? ORDER BY times_applied DESC').all(category) as Learning[];
  }

  searchLearnings(pattern: string): Learning[] {
    return this.db.prepare(`
      SELECT * FROM learnings
      WHERE pattern LIKE ? OR description LIKE ?
      ORDER BY confidence DESC, times_applied DESC
    `).all(`%${pattern}%`, `%${pattern}%`) as Learning[];
  }

  updateLearning(id: string, input: UpdateLearningInput): Learning | null {
    const learning = this.getLearning(id);
    if (!learning) return null;

    const updates: string[] = [];
    const values: unknown[] = [];

    if (input.confidence !== undefined) {
      updates.push('confidence = ?');
      values.push(input.confidence);
    }
    if (input.times_applied !== undefined) {
      updates.push('times_applied = ?');
      values.push(input.times_applied);
    }
    if (input.last_applied_at !== undefined) {
      updates.push('last_applied_at = ?');
      values.push(input.last_applied_at);
    }

    if (updates.length === 0) return learning;

    values.push(id);
    const sql = `UPDATE learnings SET ${updates.join(', ')} WHERE id = ?`;
    this.db.prepare(sql).run(...values);

    return this.getLearning(id);
  }

  incrementLearningApplied(id: string): Learning | null {
    const learning = this.getLearning(id);
    if (!learning) return null;

    this.db.prepare(`
      UPDATE learnings SET times_applied = times_applied + 1, last_applied_at = datetime('now')
      WHERE id = ?
    `).run(id);

    return this.getLearning(id);
  }

  deleteLearning(id: string): boolean {
    const result = this.db.prepare('DELETE FROM learnings WHERE id = ?').run(id);
    return result.changes > 0;
  }

  // ==================== Analysis Progress CRUD ====================

  createAnalysisProgress(input: CreateAnalysisProgressInput): AnalysisProgress {
    const id = nanoid();
    const state = JSON.stringify(input.state ?? {});

    this.db.prepare(`
      INSERT INTO analysis_progress (id, session_id, files_total, state)
      VALUES (?, ?, ?, ?)
    `).run(id, input.session_id, input.files_total, state);

    return this.getAnalysisProgress(id)!;
  }

  getAnalysisProgress(id: string): AnalysisProgress | null {
    return this.db.prepare('SELECT * FROM analysis_progress WHERE id = ?').get(id) as AnalysisProgress | null;
  }

  getAnalysisProgressBySession(sessionId: string): AnalysisProgress | null {
    return this.db.prepare(
      'SELECT * FROM analysis_progress WHERE session_id = ? ORDER BY started_at DESC LIMIT 1'
    ).get(sessionId) as AnalysisProgress | null;
  }

  updateAnalysisProgress(id: string, input: UpdateAnalysisProgressInput): AnalysisProgress | null {
    const progress = this.getAnalysisProgress(id);
    if (!progress) return null;

    const updates: string[] = [];
    const values: unknown[] = [];

    if (input.iteration !== undefined) {
      updates.push('iteration = ?');
      values.push(input.iteration);
    }
    if (input.files_analyzed !== undefined) {
      updates.push('files_analyzed = ?');
      values.push(input.files_analyzed);
    }
    if (input.issues_found !== undefined) {
      updates.push('issues_found = ?');
      values.push(input.issues_found);
    }
    if (input.issues_fixed !== undefined) {
      updates.push('issues_fixed = ?');
      values.push(input.issues_fixed);
    }
    if (input.state !== undefined) {
      updates.push('state = ?');
      values.push(JSON.stringify(input.state));
    }

    if (updates.length === 0) return progress;

    values.push(id);
    const sql = `UPDATE analysis_progress SET ${updates.join(', ')} WHERE id = ?`;
    this.db.prepare(sql).run(...values);

    return this.getAnalysisProgress(id);
  }

  deleteAnalysisProgress(id: string): boolean {
    const result = this.db.prepare('DELETE FROM analysis_progress WHERE id = ?').run(id);
    return result.changes > 0;
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
