/**
 * Sloppy Background Worker
 * Runs the orchestrator in a separate process/thread
 * Communicates via IPC for control signals and events
 */

import { parentPort, workerData, isMainThread } from 'worker_threads';
import { fork, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

import {
  Session,
  WorkerMessage,
  WorkerMessageType,
  WorkerStartPayload,
  WorkerStatusPayload,
  WorkerEventPayload,
  WorkerErrorPayload,
  WorkerCompletePayload,
  SloppyEvent,
  SessionStatus,
  Logger,
} from './services/types.js';
import {
  Orchestrator,
  createOrchestrator,
  OrchestratorDependencies,
  SessionDatabaseAdapter,
  AIProvider,
  CodeAnalyzer,
} from './services/orchestrator.js';
import { createEventEmitter, SloppyEventEmitter } from './services/event-emitter.js';
import { createVerificationService, VerificationService } from './services/verification.js';
import {
  createIssueTracker,
  IssueTracker,
  InMemoryDatabaseAdapter as IssueDbAdapter,
} from './services/issue-tracker.js';
import {
  createCheckpointService,
  CheckpointService,
  InMemoryCheckpointDatabaseAdapter as CheckpointDbAdapter,
} from './services/checkpoint.js';
import {
  createMetricsCollector,
  MetricsCollector,
  InMemoryMetricsDatabaseAdapter as MetricsDbAdapter,
} from './services/metrics-collector.js';

// ============================================================================
// Types
// ============================================================================

export interface WorkerConfig {
  sessionId: string;
  useWorkerThread: boolean; // true = worker_threads, false = child_process
}

export interface WorkerHandle {
  sessionId: string;
  status: SessionStatus;
  send(message: WorkerMessage): void;
  pause(): void;
  resume(): void;
  stop(): void;
  kill(): void;
  onEvent(handler: (event: SloppyEvent) => void): void;
  onComplete(handler: (payload: WorkerCompletePayload) => void): void;
  onError(handler: (payload: WorkerErrorPayload) => void): void;
}

// ============================================================================
// Worker Manager (runs in main process)
// ============================================================================

export class WorkerManager {
  private workers: Map<string, WorkerHandle> = new Map();
  private logger: Logger;
  private maxWorkers: number;

  constructor(logger: Logger, maxWorkers = 3) {
    this.logger = logger;
    this.maxWorkers = maxWorkers;
  }

  /**
   * Start a new worker for a session
   */
  async startWorker(
    session: Session,
    useWorkerThread = true
  ): Promise<WorkerHandle> {
    if (this.workers.size >= this.maxWorkers) {
      throw new Error(
        `Maximum workers (${this.maxWorkers}) reached. Cannot start new worker.`
      );
    }

    if (this.workers.has(session.id)) {
      throw new Error(`Worker already exists for session ${session.id}`);
    }

    this.logger.info('Starting worker', {
      sessionId: session.id,
      useWorkerThread,
    });

    const handle = useWorkerThread
      ? this.startWorkerThread(session)
      : this.startChildProcess(session);

    this.workers.set(session.id, handle);

    return handle;
  }

  /**
   * Get a worker handle by session ID
   */
  getWorker(sessionId: string): WorkerHandle | undefined {
    return this.workers.get(sessionId);
  }

  /**
   * Stop a worker
   */
  async stopWorker(sessionId: string): Promise<void> {
    const worker = this.workers.get(sessionId);
    if (worker) {
      worker.stop();
      // Don't remove immediately - wait for cleanup
    }
  }

  /**
   * Kill a worker forcefully
   */
  killWorker(sessionId: string): void {
    const worker = this.workers.get(sessionId);
    if (worker) {
      worker.kill();
      this.workers.delete(sessionId);
    }
  }

  /**
   * Remove a worker from tracking (after completion)
   */
  removeWorker(sessionId: string): void {
    this.workers.delete(sessionId);
  }

  /**
   * Get all active worker session IDs
   */
  getActiveWorkers(): string[] {
    return Array.from(this.workers.keys());
  }

  /**
   * Stop all workers
   */
  async stopAll(): Promise<void> {
    const stopPromises = Array.from(this.workers.keys()).map((id) =>
      this.stopWorker(id)
    );
    await Promise.all(stopPromises);
  }

  /**
   * Kill all workers forcefully
   */
  killAll(): void {
    for (const sessionId of this.workers.keys()) {
      this.killWorker(sessionId);
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private startWorkerThread(session: Session): WorkerHandle {
    // Dynamic import to avoid issues when worker_threads is not available
    const { Worker } = require('worker_threads');

    const eventEmitter = new EventEmitter();
    let status: SessionStatus = 'pending';

    const worker = new Worker(__filename, {
      workerData: {
        session,
        isWorker: true,
      },
    });

    const handle: WorkerHandle = {
      sessionId: session.id,
      get status() {
        return status;
      },
      send(message: WorkerMessage) {
        worker.postMessage(message);
      },
      pause() {
        this.send({
          type: 'pause',
          sessionId: session.id,
          timestamp: new Date(),
        });
      },
      resume() {
        this.send({
          type: 'resume',
          sessionId: session.id,
          timestamp: new Date(),
        });
      },
      stop() {
        this.send({
          type: 'stop',
          sessionId: session.id,
          timestamp: new Date(),
        });
      },
      kill() {
        worker.terminate();
      },
      onEvent(handler) {
        eventEmitter.on('event', handler);
      },
      onComplete(handler) {
        eventEmitter.on('complete', handler);
      },
      onError(handler) {
        eventEmitter.on('error', handler);
      },
    };

    worker.on('message', (message: WorkerMessage) => {
      this.handleWorkerMessage(message, handle, eventEmitter, (s) => {
        status = s;
      });
    });

    worker.on('error', (error: Error) => {
      this.logger.error('Worker thread error', {
        sessionId: session.id,
        error: error.message,
      });
      eventEmitter.emit('error', {
        error: error.message,
        stack: error.stack,
        fatal: true,
      });
    });

    worker.on('exit', (code: number) => {
      this.logger.info('Worker thread exited', {
        sessionId: session.id,
        code,
      });
      this.workers.delete(session.id);
    });

    // Start the worker
    handle.send({
      type: 'start',
      sessionId: session.id,
      payload: { session },
      timestamp: new Date(),
    });

    return handle;
  }

  private startChildProcess(session: Session): WorkerHandle {
    const eventEmitter = new EventEmitter();
    let status: SessionStatus = 'pending';

    const child = fork(__filename, [], {
      env: {
        ...process.env,
        SLOPPY_WORKER_MODE: 'child_process',
        SLOPPY_SESSION: JSON.stringify(session),
      },
    });

    const handle: WorkerHandle = {
      sessionId: session.id,
      get status() {
        return status;
      },
      send(message: WorkerMessage) {
        child.send(message);
      },
      pause() {
        this.send({
          type: 'pause',
          sessionId: session.id,
          timestamp: new Date(),
        });
      },
      resume() {
        this.send({
          type: 'resume',
          sessionId: session.id,
          timestamp: new Date(),
        });
      },
      stop() {
        this.send({
          type: 'stop',
          sessionId: session.id,
          timestamp: new Date(),
        });
      },
      kill() {
        child.kill('SIGKILL');
      },
      onEvent(handler) {
        eventEmitter.on('event', handler);
      },
      onComplete(handler) {
        eventEmitter.on('complete', handler);
      },
      onError(handler) {
        eventEmitter.on('error', handler);
      },
    };

    child.on('message', (message: WorkerMessage) => {
      this.handleWorkerMessage(message, handle, eventEmitter, (s) => {
        status = s;
      });
    });

    child.on('error', (error: Error) => {
      this.logger.error('Child process error', {
        sessionId: session.id,
        error: error.message,
      });
      eventEmitter.emit('error', {
        error: error.message,
        stack: error.stack,
        fatal: true,
      });
    });

    child.on('exit', (code: number | null) => {
      this.logger.info('Child process exited', {
        sessionId: session.id,
        code,
      });
      this.workers.delete(session.id);
    });

    // Start the worker
    handle.send({
      type: 'start',
      sessionId: session.id,
      payload: { session },
      timestamp: new Date(),
    });

    return handle;
  }

  private handleWorkerMessage(
    message: WorkerMessage,
    handle: WorkerHandle,
    eventEmitter: EventEmitter,
    setStatus: (status: SessionStatus) => void
  ): void {
    switch (message.type) {
      case 'event':
        const eventPayload = message.payload as WorkerEventPayload;
        eventEmitter.emit('event', eventPayload.event);
        break;

      case 'status':
        const statusPayload = message.payload as WorkerStatusPayload;
        setStatus(statusPayload.status);
        break;

      case 'complete':
        const completePayload = message.payload as WorkerCompletePayload;
        eventEmitter.emit('complete', completePayload);
        this.workers.delete(handle.sessionId);
        break;

      case 'error':
        const errorPayload = message.payload as WorkerErrorPayload;
        eventEmitter.emit('error', errorPayload);
        if (errorPayload.fatal) {
          this.workers.delete(handle.sessionId);
        }
        break;
    }
  }
}

// ============================================================================
// Worker Entry Point (runs in worker thread or child process)
// ============================================================================

class WorkerRunner {
  private session: Session | null = null;
  private orchestrator: Orchestrator | null = null;
  private logger: Logger;
  private eventEmitter: SloppyEventEmitter;

  constructor() {
    this.logger = this.createLogger();
    this.eventEmitter = createEventEmitter(this.logger);
  }

  /**
   * Initialize and run the worker
   */
  async run(): Promise<void> {
    this.logger.info('Worker starting');

    // Set up message handling
    this.setupMessageHandling();

    // If session is already available (from environment), start immediately
    if (process.env.SLOPPY_SESSION) {
      const session = JSON.parse(process.env.SLOPPY_SESSION) as Session;
      await this.startOrchestrator(session);
    }
  }

  private setupMessageHandling(): void {
    const handleMessage = async (message: WorkerMessage) => {
      this.logger.debug('Received message', { type: message.type });

      switch (message.type) {
        case 'start':
          const startPayload = message.payload as WorkerStartPayload;
          await this.startOrchestrator(startPayload.session);
          break;

        case 'pause':
          await this.orchestrator?.pause();
          break;

        case 'resume':
          await this.orchestrator?.resume();
          break;

        case 'stop':
          await this.orchestrator?.stop('Stop signal received');
          break;

        case 'status':
          this.sendStatus();
          break;
      }
    };

    // Handle messages from parent
    if (!isMainThread && parentPort) {
      parentPort.on('message', handleMessage);
    } else if (process.send) {
      process.on('message', handleMessage);
    }
  }

  private async startOrchestrator(session: Session): Promise<void> {
    this.session = session;
    this.logger.info('Starting orchestrator', { sessionId: session.id });

    try {
      // Create dependencies
      const deps = await this.createDependencies(session);
      const sessionDb = this.createSessionDbAdapter();

      // Create orchestrator
      this.orchestrator = createOrchestrator(session, deps, sessionDb);

      // Set up event forwarding
      this.eventEmitter.onAny((event: SloppyEvent) => {
        this.sendEvent(event);
      });

      // Send initial status
      this.sendStatus();

      // Run orchestrator
      await this.orchestrator.run();

      // Send completion
      const metrics = await deps.metricsCollector.getCurrentMetrics();
      const stats = await deps.issueTracker.getStats();

      this.sendMessage('complete', {
        summary: {
          sessionId: session.id,
          duration: metrics.elapsedTimeMs,
          totalIssues: stats.total,
          resolvedIssues: stats.resolved,
          failedIssues: stats.failed,
          skippedIssues: stats.skipped,
          commits: [],
          verificationResults: {
            total: metrics.totalVerifications,
            passed: metrics.passedVerifications,
            failed: metrics.failedVerifications,
          },
          codeChanges: {
            filesModified: metrics.filesModified,
            linesAdded: metrics.linesAdded,
            linesRemoved: metrics.linesRemoved,
          },
          aiUsage: {
            requests: metrics.aiRequestCount,
            tokensUsed: metrics.aiTokensUsed,
            estimatedCost: metrics.aiCost,
          },
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      this.logger.error('Orchestrator failed', {
        sessionId: session.id,
        error: errorMessage,
      });

      this.sendMessage('error', {
        error: errorMessage,
        stack: errorStack,
        fatal: true,
      });
    }
  }

  private async createDependencies(
    session: Session
  ): Promise<OrchestratorDependencies> {
    // Create database adapters (in-memory for worker, could be real DB)
    const issueDb = new IssueDbAdapter();
    const checkpointDb = new CheckpointDbAdapter();
    const metricsDb = new MetricsDbAdapter();

    // Create services
    const issueTracker = createIssueTracker(session.id, this.logger, issueDb);

    const checkpointService = createCheckpointService(
      {
        repositoryPath: session.repositoryPath,
        sessionId: session.id,
        cleaningBranch: session.cleaningBranch,
      },
      this.logger,
      checkpointDb,
      issueTracker
    );

    const metricsCollector = createMetricsCollector(
      {
        sessionId: session.id,
        repositoryPath: session.repositoryPath,
        collectionIntervalMs: 30000, // 30 seconds
      },
      this.logger,
      metricsDb,
      issueTracker,
      this.eventEmitter
    );

    const verificationService = createVerificationService(this.logger);

    // Create AI provider (placeholder - would be injected)
    const aiProvider = this.createAIProvider();

    // Create analyzer (placeholder - would be injected)
    const analyzer = this.createAnalyzer();

    return {
      logger: this.logger,
      eventEmitter: this.eventEmitter,
      verificationService,
      issueTracker,
      checkpointService,
      metricsCollector,
      aiProvider,
      analyzer,
    };
  }

  private createSessionDbAdapter(): SessionDatabaseAdapter {
    // In-memory adapter for worker
    // In production, this would connect to the real database
    const sessions = new Map<string, Session>();

    if (this.session) {
      sessions.set(this.session.id, this.session);
    }

    return {
      async getSession(id: string): Promise<Session | null> {
        return sessions.get(id) ?? null;
      },
      async updateSession(id: string, update: Partial<Session>): Promise<void> {
        const session = sessions.get(id);
        if (session) {
          Object.assign(session, update);
        }
      },
    };
  }

  private createAIProvider(): AIProvider {
    // Placeholder AI provider - in production, would connect to real AI service
    return {
      async generateFix(_request: unknown) {
        // This is a stub - real implementation would call AI service
        return {
          success: false,
          error: 'AI provider not configured',
        };
      },
    };
  }

  private createAnalyzer(): CodeAnalyzer {
    // Placeholder analyzer - in production, would use real analyzers
    return {
      async analyze(_repositoryPath: string, _types?: string[], _excludePatterns?: string[]) {
        // This is a stub - real implementation would run analyzers
        return [];
      },
    };
  }

  private createLogger(): Logger {
    const sessionId = this.session?.id ?? 'unknown';
    const logLevel = process.env['LOG_LEVEL'] ?? process.env['SLOPPY_LOG_LEVEL'] ?? 'info';
    const levels: Record<string, number> = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 };
    const currentLevel = levels[logLevel] ?? 1;

    return {
      debug(message: string, meta?: Record<string, unknown>) {
        if (currentLevel <= 0) console.debug(`[DEBUG] [${sessionId}] ${message}`, meta ?? '');
      },
      info(message: string, meta?: Record<string, unknown>) {
        if (currentLevel <= 1) console.info(`[INFO] [${sessionId}] ${message}`, meta ?? '');
      },
      warn(message: string, meta?: Record<string, unknown>) {
        if (currentLevel <= 2) console.warn(`[WARN] [${sessionId}] ${message}`, meta ?? '');
      },
      error(message: string, meta?: Record<string, unknown>) {
        if (currentLevel <= 3) console.error(`[ERROR] [${sessionId}] ${message}`, meta ?? '');
      },
    };
  }

  private sendMessage(type: WorkerMessageType, payload?: unknown): void {
    const message: WorkerMessage = {
      type,
      sessionId: this.session?.id ?? '',
      payload,
      timestamp: new Date(),
    };

    if (!isMainThread && parentPort) {
      parentPort.postMessage(message);
    } else if (process.send) {
      process.send(message);
    }
  }

  private sendStatus(): void {
    const status = this.orchestrator?.getStatus();

    this.sendMessage('status', {
      status: this.session?.status ?? 'pending',
      currentIssue: null,
      progress: {
        total: 0,
        resolved: 0,
        failed: 0,
      },
    } as WorkerStatusPayload);
  }

  private sendEvent(event: SloppyEvent): void {
    this.sendMessage('event', { event } as WorkerEventPayload);
  }
}

// ============================================================================
// Entry Point
// ============================================================================

// Check if running as a worker
if (!isMainThread || process.env.SLOPPY_WORKER_MODE === 'child_process') {
  const runner = new WorkerRunner();
  runner.run().catch((error) => {
    console.error('Worker failed to start:', error);
    process.exit(1);
  });
}

// ============================================================================
// Exports
// ============================================================================

export { WorkerRunner };
export function createWorkerManager(logger: Logger, maxWorkers?: number): WorkerManager {
  return new WorkerManager(logger, maxWorkers);
}
