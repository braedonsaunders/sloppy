/**
 * Issue Tracker Service for Sloppy
 * Manages issue lifecycle, status, and persistence
 */

import {
  Issue,
  IssueStatus,
  IssueSeverity,
  IssueCategory,
  IssueFilter,
  Logger,
  DatabaseIssue,
} from './types.js';

// ============================================================================
// Types
// ============================================================================

export interface IssueStats {
  total: number;
  pending: number;
  inProgress: number;
  resolved: number;
  failed: number;
  skipped: number;
  byCategory: Record<IssueCategory, number>;
  bySeverity: Record<IssueSeverity, number>;
}

export interface IssueUpdate {
  status?: IssueStatus;
  retryCount?: number;
  lastError?: string;
  resolvedAt?: Date;
}

export interface DatabaseAdapter {
  insertIssue(issue: DatabaseIssue): Promise<void>;
  updateIssue(id: string, update: Partial<DatabaseIssue>): Promise<void>;
  getIssue(id: string): Promise<DatabaseIssue | null>;
  getIssues(filter: IssueFilter): Promise<DatabaseIssue[]>;
  deleteIssues(sessionId: string): Promise<number>;
  bulkInsertIssues(issues: DatabaseIssue[]): Promise<void>;
  bulkUpdateIssues(ids: string[], update: Partial<DatabaseIssue>): Promise<void>;
}

// ============================================================================
// Issue Tracker Class
// ============================================================================

export class IssueTracker {
  private sessionId: string;
  private logger: Logger;
  private db: DatabaseAdapter;
  private issueCache: Map<string, Issue> = new Map();
  private issueOrder: string[] = []; // Maintains prioritized order

  constructor(sessionId: string, logger: Logger, db: DatabaseAdapter) {
    this.sessionId = sessionId;
    this.logger = logger;
    this.db = db;
  }

  /**
   * Add a single issue
   */
  async addIssue(issue: Issue): Promise<void> {
    this.logger.debug('Adding issue', {
      issueId: issue.id,
      type: issue.type,
      severity: issue.severity,
    });

    // Store in cache
    this.issueCache.set(issue.id, issue);
    this.issueOrder.push(issue.id);

    // Persist to database
    await this.db.insertIssue(this.toDbIssue(issue));
  }

  /**
   * Add multiple issues at once
   */
  async addIssues(issues: Issue[]): Promise<void> {
    this.logger.info('Adding issues', { count: issues.length });

    // Store in cache
    for (const issue of issues) {
      this.issueCache.set(issue.id, issue);
      this.issueOrder.push(issue.id);
    }

    // Bulk persist to database
    const dbIssues = issues.map((i) => this.toDbIssue(i));
    await this.db.bulkInsertIssues(dbIssues);

    this.logger.info('Issues added successfully', { count: issues.length });
  }

  /**
   * Get an issue by ID
   */
  async getIssue(issueId: string): Promise<Issue | null> {
    // Check cache first
    const cached = this.issueCache.get(issueId);
    if (cached) {
      return cached;
    }

    // Fetch from database
    const dbIssue = await this.db.getIssue(issueId);
    if (dbIssue) {
      const issue = this.fromDbIssue(dbIssue);
      this.issueCache.set(issueId, issue);
      return issue;
    }

    return null;
  }

  /**
   * Get the next issue to work on
   */
  async getNextIssue(): Promise<Issue | null> {
    // Find the first pending issue in the prioritized order
    for (const issueId of this.issueOrder) {
      const issue = this.issueCache.get(issueId);
      if (issue && issue.status === 'pending') {
        return issue;
      }
    }

    // If cache is incomplete, fetch from database
    const dbIssues = await this.db.getIssues({
      sessionId: this.sessionId,
      status: 'pending',
    });

    if (dbIssues.length > 0) {
      const issue = this.fromDbIssue(dbIssues[0]);
      this.issueCache.set(issue.id, issue);
      return issue;
    }

    return null;
  }

  /**
   * Get all issues matching a filter
   */
  async getIssues(filter?: IssueFilter): Promise<Issue[]> {
    const fullFilter: IssueFilter = {
      ...filter,
      sessionId: this.sessionId,
    };

    const dbIssues = await this.db.getIssues(fullFilter);
    const issues = dbIssues.map((di) => this.fromDbIssue(di));

    // Update cache
    for (const issue of issues) {
      this.issueCache.set(issue.id, issue);
    }

    return issues;
  }

  /**
   * Update issue status to in_progress
   */
  async markInProgress(issueId: string): Promise<void> {
    await this.updateIssue(issueId, {
      status: 'in_progress',
    });

    this.logger.info('Issue marked in progress', { issueId });
  }

  /**
   * Update issue status to resolved
   */
  async markResolved(issueId: string): Promise<void> {
    await this.updateIssue(issueId, {
      status: 'resolved',
      resolvedAt: new Date(),
    });

    this.logger.info('Issue marked resolved', { issueId });
  }

  /**
   * Update issue status to failed
   */
  async markFailed(issueId: string, error: string): Promise<void> {
    const issue = await this.getIssue(issueId);
    if (!issue) {
      throw new Error(`Issue not found: ${issueId}`);
    }

    await this.updateIssue(issueId, {
      status: 'failed',
      lastError: error,
      retryCount: issue.retryCount,
    });

    this.logger.info('Issue marked failed', { issueId, error });
  }

  /**
   * Update issue status to skipped
   */
  async markSkipped(issueId: string, reason: string): Promise<void> {
    await this.updateIssue(issueId, {
      status: 'skipped',
      lastError: reason,
    });

    this.logger.info('Issue marked skipped', { issueId, reason });
  }

  /**
   * Increment retry count for an issue
   */
  async incrementRetry(issueId: string): Promise<number> {
    const issue = await this.getIssue(issueId);
    if (!issue) {
      throw new Error(`Issue not found: ${issueId}`);
    }

    const newRetryCount = issue.retryCount + 1;
    await this.updateIssue(issueId, {
      retryCount: newRetryCount,
    });

    this.logger.debug('Issue retry count incremented', {
      issueId,
      retryCount: newRetryCount,
    });

    return newRetryCount;
  }

  /**
   * Reset issue to pending status (for retry)
   */
  async resetToPending(issueId: string): Promise<void> {
    await this.updateIssue(issueId, {
      status: 'pending',
    });

    this.logger.debug('Issue reset to pending', { issueId });
  }

  /**
   * Prioritize issues based on severity and other factors
   */
  prioritize(): void {
    this.logger.info('Prioritizing issues');

    const severityOrder: Record<IssueSeverity, number> = {
      critical: 0,
      high: 1,
      medium: 2,
      low: 3,
      info: 4,
    };

    const categoryOrder: Record<IssueCategory, number> = {
      error: 0,
      security: 1,
      performance: 2,
      warning: 3,
      complexity: 4,
      maintainability: 5,
      style: 6,
    };

    // Sort issue order based on priority
    this.issueOrder.sort((a, b) => {
      const issueA = this.issueCache.get(a);
      const issueB = this.issueCache.get(b);

      if (!issueA || !issueB) return 0;

      // First sort by severity
      const severityDiff =
        severityOrder[issueA.severity] - severityOrder[issueB.severity];
      if (severityDiff !== 0) return severityDiff;

      // Then by category
      const categoryDiff =
        categoryOrder[issueA.category] - categoryOrder[issueB.category];
      if (categoryDiff !== 0) return categoryDiff;

      // Then by file path (group related issues)
      return issueA.filePath.localeCompare(issueB.filePath);
    });

    this.logger.info('Issues prioritized', { count: this.issueOrder.length });
  }

  /**
   * Get issue statistics
   */
  async getStats(): Promise<IssueStats> {
    const issues = await this.getIssues();

    const stats: IssueStats = {
      total: issues.length,
      pending: 0,
      inProgress: 0,
      resolved: 0,
      failed: 0,
      skipped: 0,
      byCategory: {
        error: 0,
        warning: 0,
        style: 0,
        complexity: 0,
        security: 0,
        performance: 0,
        maintainability: 0,
      },
      bySeverity: {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        info: 0,
      },
    };

    for (const issue of issues) {
      // Count by status
      switch (issue.status) {
        case 'pending':
          stats.pending++;
          break;
        case 'in_progress':
          stats.inProgress++;
          break;
        case 'resolved':
          stats.resolved++;
          break;
        case 'failed':
          stats.failed++;
          break;
        case 'skipped':
          stats.skipped++;
          break;
      }

      // Count by category
      stats.byCategory[issue.category]++;

      // Count by severity
      stats.bySeverity[issue.severity]++;
    }

    return stats;
  }

  /**
   * Get issues that can still be retried
   */
  async getRetryableIssues(maxRetries: number): Promise<Issue[]> {
    const issues = await this.getIssues({ status: 'failed' });
    return issues.filter((issue) => issue.retryCount < maxRetries);
  }

  /**
   * Reset all failed issues with retries remaining
   */
  async resetRetryableIssues(maxRetries: number): Promise<number> {
    const retryable = await this.getRetryableIssues(maxRetries);
    const ids = retryable.map((i) => i.id);

    if (ids.length > 0) {
      await this.db.bulkUpdateIssues(ids, { status: 'pending' });

      // Update cache
      for (const id of ids) {
        const issue = this.issueCache.get(id);
        if (issue) {
          issue.status = 'pending';
        }
      }
    }

    this.logger.info('Reset retryable issues', { count: ids.length });
    return ids.length;
  }

  /**
   * Clear all issues for the session
   */
  async clearAll(): Promise<void> {
    await this.db.deleteIssues(this.sessionId);
    this.issueCache.clear();
    this.issueOrder = [];

    this.logger.info('All issues cleared for session', {
      sessionId: this.sessionId,
    });
  }

  /**
   * Load issues from database into cache
   */
  async loadFromDatabase(): Promise<void> {
    const dbIssues = await this.db.getIssues({ sessionId: this.sessionId });

    this.issueCache.clear();
    this.issueOrder = [];

    for (const dbIssue of dbIssues) {
      const issue = this.fromDbIssue(dbIssue);
      this.issueCache.set(issue.id, issue);
      this.issueOrder.push(issue.id);
    }

    this.logger.info('Issues loaded from database', {
      count: this.issueCache.size,
    });
  }

  /**
   * Check if an issue still exists (file and line still present)
   */
  async checkIssueExists(issue: Issue, fileContent: string): Promise<boolean> {
    // Basic existence check - verify the code snippet is still present
    if (issue.codeSnippet) {
      const snippetExists = fileContent.includes(issue.codeSnippet.trim());
      if (!snippetExists) {
        this.logger.debug('Issue code snippet not found', {
          issueId: issue.id,
          filePath: issue.filePath,
        });
        return false;
      }
    }

    // Check if line count is still valid
    const lines = fileContent.split('\n');
    if (issue.line > lines.length) {
      this.logger.debug('Issue line number out of range', {
        issueId: issue.id,
        line: issue.line,
        totalLines: lines.length,
      });
      return false;
    }

    return true;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private async updateIssue(issueId: string, update: IssueUpdate): Promise<void> {
    // Update cache
    const cached = this.issueCache.get(issueId);
    if (cached) {
      if (update.status !== undefined) cached.status = update.status;
      if (update.retryCount !== undefined) cached.retryCount = update.retryCount;
      if (update.lastError !== undefined) cached.lastError = update.lastError;
      if (update.resolvedAt !== undefined) cached.resolvedAt = update.resolvedAt;
      cached.updatedAt = new Date();
    }

    // Persist to database
    const dbUpdate: Partial<DatabaseIssue> = {
      updatedAt: new Date().toISOString(),
    };

    if (update.status !== undefined) dbUpdate.status = update.status;
    if (update.retryCount !== undefined) dbUpdate.retryCount = update.retryCount;
    if (update.lastError !== undefined) dbUpdate.lastError = update.lastError;
    if (update.resolvedAt !== undefined)
      dbUpdate.resolvedAt = update.resolvedAt.toISOString();

    await this.db.updateIssue(issueId, dbUpdate);
  }

  private toDbIssue(issue: Issue): DatabaseIssue {
    return {
      ...issue,
      resolvedAt: issue.resolvedAt?.toISOString() ?? null,
      createdAt: issue.createdAt.toISOString(),
      updatedAt: issue.updatedAt.toISOString(),
    };
  }

  private fromDbIssue(dbIssue: DatabaseIssue): Issue {
    return {
      ...dbIssue,
      resolvedAt: dbIssue.resolvedAt ? new Date(dbIssue.resolvedAt) : undefined,
      createdAt: new Date(dbIssue.createdAt),
      updatedAt: new Date(dbIssue.updatedAt),
    };
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createIssueTracker(
  sessionId: string,
  logger: Logger,
  db: DatabaseAdapter
): IssueTracker {
  return new IssueTracker(sessionId, logger, db);
}

// ============================================================================
// In-Memory Database Adapter (for testing)
// ============================================================================

export class InMemoryDatabaseAdapter implements DatabaseAdapter {
  private issues: Map<string, DatabaseIssue> = new Map();

  async insertIssue(issue: DatabaseIssue): Promise<void> {
    this.issues.set(issue.id, { ...issue });
  }

  async updateIssue(id: string, update: Partial<DatabaseIssue>): Promise<void> {
    const existing = this.issues.get(id);
    if (existing) {
      this.issues.set(id, { ...existing, ...update });
    }
  }

  async getIssue(id: string): Promise<DatabaseIssue | null> {
    return this.issues.get(id) ?? null;
  }

  async getIssues(filter: IssueFilter): Promise<DatabaseIssue[]> {
    let results = Array.from(this.issues.values());

    if (filter.sessionId) {
      results = results.filter((i) => i.sessionId === filter.sessionId);
    }

    if (filter.status) {
      const statuses = Array.isArray(filter.status)
        ? filter.status
        : [filter.status];
      results = results.filter((i) => statuses.includes(i.status));
    }

    if (filter.severity) {
      const severities = Array.isArray(filter.severity)
        ? filter.severity
        : [filter.severity];
      results = results.filter((i) => severities.includes(i.severity));
    }

    if (filter.category) {
      const categories = Array.isArray(filter.category)
        ? filter.category
        : [filter.category];
      results = results.filter((i) => categories.includes(i.category));
    }

    if (filter.filePath) {
      results = results.filter((i) => i.filePath === filter.filePath);
    }

    return results;
  }

  async deleteIssues(sessionId: string): Promise<number> {
    let deleted = 0;
    for (const [id, issue] of this.issues.entries()) {
      if (issue.sessionId === sessionId) {
        this.issues.delete(id);
        deleted++;
      }
    }
    return deleted;
  }

  async bulkInsertIssues(issues: DatabaseIssue[]): Promise<void> {
    for (const issue of issues) {
      this.issues.set(issue.id, { ...issue });
    }
  }

  async bulkUpdateIssues(
    ids: string[],
    update: Partial<DatabaseIssue>
  ): Promise<void> {
    for (const id of ids) {
      const existing = this.issues.get(id);
      if (existing) {
        this.issues.set(id, { ...existing, ...update });
      }
    }
  }

  // Utility method for testing
  clear(): void {
    this.issues.clear();
  }
}
