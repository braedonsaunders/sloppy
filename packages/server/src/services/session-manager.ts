/**
 * SessionManager - Manages cleaning sessions lifecycle
 * Coordinates with orchestrator, handles pause/resume/stop operations
 */

import { z } from 'zod';
import {
  SloppyDatabase,
  type Session,
  type SessionStatus,
  type CreateSessionInput,
  type Issue,
  type Commit,
  type Metric,
} from '../db/database.js';
import { getWebSocketHandler } from '../websocket/handler.js';

// Validation schemas
export const CreateSessionSchema = z.object({
  repoPath: z.string().min(1, 'Repository path is required'),
  branch: z.string().min(1, 'Branch name is required'),
  maxTimeMinutes: z.number().int().min(1).max(480).optional().default(60),
  providerConfig: z.object({
    provider: z.enum(['anthropic', 'openai', 'azure', 'local']).optional(),
    model: z.string().optional(),
    apiKeyEnvVar: z.string().optional(),
  }).optional(),
  config: z.object({
    analyzers: z.array(z.string()).optional(),
    autoCommit: z.boolean().optional(),
    approvalMode: z.boolean().optional(),
    maxAttempts: z.number().int().min(1).max(10).optional(),
    ignorePatterns: z.array(z.string()).optional(),
  }).optional(),
});

export type CreateSessionRequest = z.infer<typeof CreateSessionSchema>;

export interface SessionWithStats extends Session {
  stats: {
    totalIssues: number;
    resolvedIssues: number;
    totalCommits: number;
    revertedCommits: number;
  };
}

export interface SessionManagerOptions {
  db: SloppyDatabase;
  logger?: Console;
}

/**
 * Manages the lifecycle of cleaning sessions
 */
export class SessionManager {
  private db: SloppyDatabase;
  private logger: Console;
  private activeSessions: Map<string, { status: SessionStatus; timer?: NodeJS.Timeout }> = new Map();

  constructor(options: SessionManagerOptions) {
    this.db = options.db;
    this.logger = options.logger ?? console;
  }

  /**
   * Create a new cleaning session
   */
  async createSession(request: CreateSessionRequest): Promise<SessionWithStats> {
    // Validate request
    const validated = CreateSessionSchema.parse(request);

    // Create session in database
    const input: CreateSessionInput = {
      repo_path: validated.repoPath,
      branch: validated.branch,
      max_time_minutes: validated.maxTimeMinutes,
      provider_config: validated.providerConfig,
      config: validated.config,
    };

    const session = this.db.createSession(input);
    this.logger.info(`[session-manager] Created session ${session.id} for ${session.repo_path}`);

    // Track in active sessions
    this.activeSessions.set(session.id, { status: 'pending' });

    // Broadcast creation event
    const wsHandler = getWebSocketHandler();
    wsHandler.broadcastToAll({
      type: 'session:updated',
      data: { session, action: 'created' },
    });

    return this.enrichSession(session);
  }

  /**
   * Get a session by ID with stats
   */
  async getSession(id: string): Promise<SessionWithStats | null> {
    const session = this.db.getSession(id);
    if (!session) return null;
    return this.enrichSession(session);
  }

  /**
   * List all sessions with stats
   */
  async listSessions(status?: SessionStatus): Promise<SessionWithStats[]> {
    const sessions = this.db.listSessions(status);
    return sessions.map((session) => this.enrichSession(session));
  }

  /**
   * Start a session
   */
  async startSession(id: string): Promise<SessionWithStats> {
    const session = this.db.getSession(id);
    if (!session) {
      throw new Error(`Session not found: ${id}`);
    }

    if (session.status !== 'pending' && session.status !== 'paused') {
      throw new Error(`Cannot start session in status: ${session.status}`);
    }

    // Update session status
    const updated = this.db.updateSession(id, {
      status: 'running',
      started_at: session.started_at ?? new Date().toISOString(),
    });

    if (!updated) {
      throw new Error(`Failed to update session: ${id}`);
    }

    // Update active sessions tracking
    this.activeSessions.set(id, { status: 'running' });

    // Set up max time timer
    this.setupMaxTimeTimer(id, updated.max_time_minutes);

    this.logger.info(`[session-manager] Started session ${id}`);

    // Broadcast start event
    const wsHandler = getWebSocketHandler();
    wsHandler.broadcastToSession(id, {
      type: 'session:started',
      data: { session: updated },
    });

    return this.enrichSession(updated);
  }

  /**
   * Pause a session
   */
  async pauseSession(id: string): Promise<SessionWithStats> {
    const session = this.db.getSession(id);
    if (!session) {
      throw new Error(`Session not found: ${id}`);
    }

    if (session.status !== 'running') {
      throw new Error(`Cannot pause session in status: ${session.status}`);
    }

    // Update session status
    const updated = this.db.updateSession(id, { status: 'paused' });
    if (!updated) {
      throw new Error(`Failed to update session: ${id}`);
    }

    // Clear max time timer
    this.clearMaxTimeTimer(id);

    // Update active sessions tracking
    const active = this.activeSessions.get(id);
    if (active) {
      active.status = 'paused';
    }

    this.logger.info(`[session-manager] Paused session ${id}`);

    // Broadcast pause event
    const wsHandler = getWebSocketHandler();
    wsHandler.broadcastToSession(id, {
      type: 'session:paused',
      data: { session: updated },
    });

    return this.enrichSession(updated);
  }

  /**
   * Resume a paused session
   */
  async resumeSession(id: string): Promise<SessionWithStats> {
    const session = this.db.getSession(id);
    if (!session) {
      throw new Error(`Session not found: ${id}`);
    }

    if (session.status !== 'paused') {
      throw new Error(`Cannot resume session in status: ${session.status}`);
    }

    // Update session status
    const updated = this.db.updateSession(id, { status: 'running' });
    if (!updated) {
      throw new Error(`Failed to update session: ${id}`);
    }

    // Restart max time timer (with remaining time calculation if needed)
    this.setupMaxTimeTimer(id, updated.max_time_minutes);

    // Update active sessions tracking
    const active = this.activeSessions.get(id);
    if (active) {
      active.status = 'running';
    }

    this.logger.info(`[session-manager] Resumed session ${id}`);

    // Broadcast resume event
    const wsHandler = getWebSocketHandler();
    wsHandler.broadcastToSession(id, {
      type: 'session:resumed',
      data: { session: updated },
    });

    return this.enrichSession(updated);
  }

  /**
   * Stop a session
   */
  async stopSession(id: string): Promise<SessionWithStats> {
    const session = this.db.getSession(id);
    if (!session) {
      throw new Error(`Session not found: ${id}`);
    }

    if (session.status === 'completed' || session.status === 'failed' || session.status === 'stopped') {
      throw new Error(`Session already ended with status: ${session.status}`);
    }

    // Update session status
    const updated = this.db.updateSession(id, {
      status: 'stopped',
      ended_at: new Date().toISOString(),
    });

    if (!updated) {
      throw new Error(`Failed to update session: ${id}`);
    }

    // Clear max time timer
    this.clearMaxTimeTimer(id);

    // Remove from active sessions
    this.activeSessions.delete(id);

    this.logger.info(`[session-manager] Stopped session ${id}`);

    // Broadcast stop event
    const wsHandler = getWebSocketHandler();
    wsHandler.broadcastToSession(id, {
      type: 'session:stopped',
      data: { session: updated },
    });

    return this.enrichSession(updated);
  }

  /**
   * Mark a session as completed
   */
  async completeSession(id: string): Promise<SessionWithStats> {
    const session = this.db.getSession(id);
    if (!session) {
      throw new Error(`Session not found: ${id}`);
    }

    // Update session status
    const updated = this.db.updateSession(id, {
      status: 'completed',
      ended_at: new Date().toISOString(),
    });

    if (!updated) {
      throw new Error(`Failed to update session: ${id}`);
    }

    // Clear max time timer
    this.clearMaxTimeTimer(id);

    // Remove from active sessions
    this.activeSessions.delete(id);

    this.logger.info(`[session-manager] Completed session ${id}`);

    // Broadcast completion event
    const wsHandler = getWebSocketHandler();
    wsHandler.broadcastToSession(id, {
      type: 'session:completed',
      data: { session: updated },
    });

    return this.enrichSession(updated);
  }

  /**
   * Mark a session as failed
   */
  async failSession(id: string, error?: string): Promise<SessionWithStats> {
    const session = this.db.getSession(id);
    if (!session) {
      throw new Error(`Session not found: ${id}`);
    }

    // Update session status
    const updated = this.db.updateSession(id, {
      status: 'failed',
      ended_at: new Date().toISOString(),
    });

    if (!updated) {
      throw new Error(`Failed to update session: ${id}`);
    }

    // Clear max time timer
    this.clearMaxTimeTimer(id);

    // Remove from active sessions
    this.activeSessions.delete(id);

    this.logger.error(`[session-manager] Session ${id} failed: ${error ?? 'Unknown error'}`);

    // Broadcast failure event
    const wsHandler = getWebSocketHandler();
    wsHandler.broadcastToSession(id, {
      type: 'session:failed',
      data: { session: updated, error },
    });

    return this.enrichSession(updated);
  }

  /**
   * Delete a session
   */
  async deleteSession(id: string): Promise<boolean> {
    const session = this.db.getSession(id);
    if (!session) {
      return false;
    }

    // Stop session if running
    if (session.status === 'running' || session.status === 'paused') {
      await this.stopSession(id);
    }

    // Delete from database
    const deleted = this.db.deleteSession(id);

    if (deleted) {
      this.activeSessions.delete(id);
      this.logger.info(`[session-manager] Deleted session ${id}`);
    }

    return deleted;
  }

  /**
   * Get issues for a session
   */
  getSessionIssues(sessionId: string): Issue[] {
    return this.db.listIssuesBySession(sessionId);
  }

  /**
   * Get commits for a session
   */
  getSessionCommits(sessionId: string, includeReverted = true): Commit[] {
    return this.db.listCommitsBySession(sessionId, includeReverted);
  }

  /**
   * Get metrics for a session
   */
  getSessionMetrics(sessionId: string): Metric[] {
    return this.db.listMetricsBySession(sessionId);
  }

  /**
   * Check if a session is active
   */
  isSessionActive(id: string): boolean {
    const active = this.activeSessions.get(id);
    return active?.status === 'running';
  }

  /**
   * Get count of active sessions
   */
  getActiveSessionCount(): number {
    let count = 0;
    for (const session of this.activeSessions.values()) {
      if (session.status === 'running') {
        count++;
      }
    }
    return count;
  }

  /**
   * Set up max time timer for a session
   */
  private setupMaxTimeTimer(id: string, maxTimeMinutes: number): void {
    const active = this.activeSessions.get(id);
    if (!active) return;

    // Clear existing timer
    if (active.timer) {
      clearTimeout(active.timer);
    }

    // Set new timer
    active.timer = setTimeout(
      () => {
        this.logger.info(`[session-manager] Session ${id} reached max time limit`);
        void this.completeSession(id).catch((error) => {
          this.logger.error(`[session-manager] Error completing session ${id}:`, error);
        });
      },
      maxTimeMinutes * 60 * 1000
    );
  }

  /**
   * Clear max time timer for a session
   */
  private clearMaxTimeTimer(id: string): void {
    const active = this.activeSessions.get(id);
    if (active?.timer) {
      clearTimeout(active.timer);
      active.timer = undefined;
    }
  }

  /**
   * Enrich session with stats
   */
  private enrichSession(session: Session): SessionWithStats {
    const stats = this.db.getSessionStats(session.id);
    return { ...session, stats };
  }

  /**
   * Cleanup - stop all active sessions
   */
  async shutdown(): Promise<void> {
    this.logger.info('[session-manager] Shutting down...');

    const promises: Promise<unknown>[] = [];

    for (const [id, session] of this.activeSessions) {
      if (session.status === 'running' || session.status === 'paused') {
        promises.push(
          this.stopSession(id).catch((error) => {
            this.logger.error(`[session-manager] Error stopping session ${id} during shutdown:`, error);
          })
        );
      }
    }

    await Promise.all(promises);
    this.activeSessions.clear();
    this.logger.info('[session-manager] Shutdown complete');
  }
}

// Singleton instance
let sessionManager: SessionManager | null = null;

export function getSessionManager(options?: SessionManagerOptions): SessionManager {
  if (!sessionManager) {
    if (!options) {
      throw new Error('SessionManager not initialized. Provide options on first call.');
    }
    sessionManager = new SessionManager(options);
  }
  return sessionManager;
}

export function closeSessionManager(): Promise<void> {
  if (sessionManager) {
    const manager = sessionManager;
    sessionManager = null;
    return manager.shutdown();
  }
  return Promise.resolve();
}
