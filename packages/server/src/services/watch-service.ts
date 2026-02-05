/**
 * WatchService - Watches a directory for file changes and triggers re-analysis.
 * Provides the backend for "watch mode" - a persistent development companion.
 */

import { watch, type FSWatcher } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';
import { getWebSocketHandler } from '../websocket/handler.js';
import { getDatabase } from '../db/database.js';

export interface WatchSession {
  id: string;
  repoPath: string;
  status: 'watching' | 'analyzing' | 'paused' | 'stopped';
  startedAt: string;
  issuesFixed: number;
  lastActivity: string;
  watcher: FSWatcher | null;
  debounceTimer: NodeJS.Timeout | null;
  changedFiles: Set<string>;
}

const DEBOUNCE_MS = 2000;
const IGNORED_PATTERNS = [
  'node_modules', 'dist', 'build', '.git', 'coverage',
  '__pycache__', 'venv', '.venv', 'target', 'vendor',
  '.next', '.nuxt',
];

const WATCHED_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.rs', '.java', '.kt', '.rb', '.php',
  '.c', '.cpp', '.h', '.cs', '.swift', '.sh',
  '.html', '.css', '.scss', '.vue', '.svelte',
]);

export class WatchService {
  private sessions: Map<string, WatchSession> = new Map();
  private logger: Console;

  constructor(logger?: Console) {
    this.logger = logger ?? console;
  }

  async startWatching(repoPath: string, sessionId?: string): Promise<WatchSession> {
    const id = sessionId ?? `watch-${Date.now()}`;

    if (this.sessions.has(id)) {
      throw new Error(`Watch session ${id} already exists`);
    }

    const session: WatchSession = {
      id,
      repoPath,
      status: 'watching',
      startedAt: new Date().toISOString(),
      issuesFixed: 0,
      lastActivity: new Date().toISOString(),
      watcher: null,
      debounceTimer: null,
      changedFiles: new Set(),
    };

    try {
      session.watcher = watch(repoPath, { recursive: true }, (eventType, filename) => {
        if (!filename) return;

        // Check if file should be watched
        if (this.shouldIgnore(filename)) return;

        const ext = extname(filename);
        if (!WATCHED_EXTENSIONS.has(ext)) return;

        session.changedFiles.add(filename);
        session.lastActivity = new Date().toISOString();

        // Debounce: wait for changes to settle
        if (session.debounceTimer) {
          clearTimeout(session.debounceTimer);
        }

        session.debounceTimer = setTimeout(() => {
          void this.handleChanges(session);
        }, DEBOUNCE_MS);
      });

      this.sessions.set(id, session);
      this.logger.info(`[watch] Started watching ${repoPath} (session: ${id})`);

      // Broadcast watch started
      const wsHandler = getWebSocketHandler();
      wsHandler.broadcastToAll({
        type: 'activity:log',
        data: {
          type: 'info',
          message: `Watch mode started for ${repoPath}`,
          timestamp: new Date().toISOString(),
          watchSessionId: id,
        },
      });

      return session;
    } catch (error) {
      throw new Error(`Failed to start watching ${repoPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  stopWatching(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;

    if (session.watcher) {
      session.watcher.close();
      session.watcher = null;
    }
    if (session.debounceTimer) {
      clearTimeout(session.debounceTimer);
      session.debounceTimer = null;
    }

    session.status = 'stopped';
    this.sessions.delete(id);
    this.logger.info(`[watch] Stopped watching (session: ${id})`);

    const wsHandler = getWebSocketHandler();
    wsHandler.broadcastToAll({
      type: 'activity:log',
      data: {
        type: 'info',
        message: `Watch mode stopped`,
        timestamp: new Date().toISOString(),
        watchSessionId: id,
      },
    });

    return true;
  }

  getSession(id: string): WatchSession | undefined {
    return this.sessions.get(id);
  }

  listSessions(): Array<Omit<WatchSession, 'watcher' | 'debounceTimer' | 'changedFiles'> & { changedFiles: string[] }> {
    return Array.from(this.sessions.values()).map(s => ({
      id: s.id,
      repoPath: s.repoPath,
      status: s.status,
      startedAt: s.startedAt,
      issuesFixed: s.issuesFixed,
      lastActivity: s.lastActivity,
      changedFiles: Array.from(s.changedFiles),
    }));
  }

  pauseWatching(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session || session.status !== 'watching') return false;
    session.status = 'paused';
    return true;
  }

  resumeWatching(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session || session.status !== 'paused') return false;
    session.status = 'watching';
    return true;
  }

  private async handleChanges(session: WatchSession): Promise<void> {
    if (session.status !== 'watching') return;

    const changedFiles = Array.from(session.changedFiles);
    session.changedFiles.clear();
    session.status = 'analyzing';

    this.logger.info(`[watch] ${changedFiles.length} files changed, triggering analysis`);

    const wsHandler = getWebSocketHandler();
    wsHandler.broadcastToAll({
      type: 'activity:log',
      data: {
        type: 'analyzing',
        message: `Detected changes in ${changedFiles.length} file(s): ${changedFiles.slice(0, 3).join(', ')}${changedFiles.length > 3 ? '...' : ''}`,
        timestamp: new Date().toISOString(),
        watchSessionId: session.id,
        changedFiles,
      },
    });

    // Analysis would be triggered here - for now emit event
    // The actual analysis integration happens via the analysis-runner
    session.status = 'watching';
    session.lastActivity = new Date().toISOString();
  }

  private shouldIgnore(filename: string): boolean {
    return IGNORED_PATTERNS.some(pattern => filename.includes(pattern));
  }

  async shutdown(): Promise<void> {
    for (const id of this.sessions.keys()) {
      this.stopWatching(id);
    }
  }
}

// Singleton
let watchService: WatchService | null = null;

export function getWatchService(logger?: Console): WatchService {
  if (!watchService) {
    watchService = new WatchService(logger);
  }
  return watchService;
}

export function closeWatchService(): Promise<void> {
  if (watchService) {
    const service = watchService;
    watchService = null;
    return service.shutdown();
  }
  return Promise.resolve();
}
