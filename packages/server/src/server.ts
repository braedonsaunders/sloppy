/**
 * Fastify server setup
 * Configures CORS, WebSocket, static files, routes, and graceful shutdown
 */

import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyWebsocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

import { getDatabase, closeDatabase, type DatabaseOptions } from './db/database.js';
import { getWebSocketHandler, closeWebSocketHandler, registerWebSocketRoute } from './websocket/handler.js';
import { getSessionManager, closeSessionManager } from './services/session-manager.js';
import { getAnalysisRunner, closeAnalysisRunner } from './services/analysis-runner.js';
import { registerSessionRoutes } from './routes/sessions.js';
import { registerIssueRoutes } from './routes/issues.js';
import { registerCommitRoutes } from './routes/commits.js';
import { registerMetricsRoutes } from './routes/metrics.js';
import { registerProviderRoutes } from './routes/providers.js';
import { registerSettingsRoutes } from './routes/settings.js';
import { registerFileRoutes } from './routes/files.js';
import { registerGitHubRoutes } from './routes/github.js';
import { registerScoreRoutes } from './routes/score.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface ServerOptions {
  host?: string;
  port?: number;
  dbPath?: string;
  staticDir?: string;
  corsOrigin?: string | string[] | boolean;
  logLevel?: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
}

export interface SloppyServer {
  app: FastifyInstance;
  start: () => Promise<string>;
  stop: () => Promise<void>;
}

/**
 * Create and configure the Fastify server
 */
export async function createServer(options: ServerOptions = {}): Promise<SloppyServer> {
  const {
    host = '0.0.0.0',
    port = 7749,
    dbPath = join(__dirname, '..', 'data', 'sloppy.db'),
    staticDir = join(__dirname, '..', '..', 'ui', 'dist'),
    corsOrigin = true,
    logLevel = 'info',
  } = options;

  // Create Fastify instance
  // Disable request logging to reduce noise - only errors and explicit logs will show
  const app = Fastify({
    disableRequestLogging: true, // Don't log every request/response
    logger: {
      level: logLevel,
      transport:
        process.env['NODE_ENV'] !== 'production'
          ? {
              target: 'pino-pretty',
              options: {
                colorize: true,
                translateTime: 'HH:MM:ss Z',
                ignore: 'pid,hostname',
              },
            }
          : undefined,
    },
  });

  // Initialize database
  const dbOptions: DatabaseOptions = {
    path: dbPath,
    logger: app.log as unknown as Console,
  };
  const db = getDatabase(dbOptions);

  // Initialize WebSocket handler
  const wsHandler = getWebSocketHandler(app.log as unknown as Console);
  wsHandler.start();

  // Initialize session manager
  getSessionManager({
    db,
    logger: app.log as unknown as Console,
  });

  // Initialize analysis runner
  getAnalysisRunner({
    db,
    logger: app.log as unknown as Console,
  });

  // Register CORS
  await app.register(fastifyCors, {
    origin: corsOrigin,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  // Register WebSocket support
  await app.register(fastifyWebsocket, {
    options: {
      maxPayload: 1048576, // 1MB
    },
  });

  // Register static file serving for UI (if directory exists)
  if (existsSync(staticDir)) {
    await app.register(fastifyStatic, {
      root: staticDir,
      prefix: '/',
    });
    app.log.info(`[server] Static files served from ${staticDir}`);
  } else {
    app.log.warn(`[server] Static directory not found: ${staticDir}`);
  }

  // Register WebSocket route
  registerWebSocketRoute(app);

  // Register REST routes
  await registerSessionRoutes(app);
  await registerIssueRoutes(app);
  await registerCommitRoutes(app);
  await registerMetricsRoutes(app);
  await registerProviderRoutes(app);
  await registerSettingsRoutes(app);
  await registerFileRoutes(app);
  await registerGitHubRoutes(app);
  await registerScoreRoutes(app);

  // Health check endpoint
  app.get('/health', async () => {
    const wsStats = wsHandler.getStats();
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      websocket: wsStats,
    };
  });

  // API info endpoint
  app.get('/api', async () => {
    return {
      name: '@sloppy/server',
      version: '0.1.0',
      endpoints: {
        sessions: '/api/sessions',
        issues: '/api/issues/:id',
        commits: '/api/commits/:id',
        metrics: '/api/sessions/:id/metrics',
        providers: '/api/providers',
        settings: '/api/settings',
        github: '/api/github',
        score: '/api/sessions/:id/score',
        websocket: '/ws',
        health: '/health',
      },
    };
  });

  // 404 handler for API routes
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/')) {
      void reply.code(404).send({
        success: false,
        error: { message: 'Endpoint not found' },
      });
    } else if (existsSync(staticDir)) {
      // For non-API routes, serve index.html (SPA support)
      void reply.sendFile('index.html');
    } else {
      void reply.code(404).send({
        success: false,
        error: { message: 'Not found' },
      });
    }
  });

  // Global error handler
  app.setErrorHandler((error, request, reply) => {
    app.log.error({ err: error, url: request.url }, 'Request error');

    const statusCode = error.statusCode ?? 500;
    void reply.code(statusCode).send({
      success: false,
      error: {
        message: statusCode === 500 ? 'Internal server error' : error.message,
        ...(process.env['NODE_ENV'] !== 'production' && { stack: error.stack }),
      },
    });
  });

  // Graceful shutdown handling
  let isShuttingDown = false;
  const SHUTDOWN_TIMEOUT_MS = 10000; // 10 seconds max for graceful shutdown

  async function shutdown(signal: string, exitCode = 0): Promise<void> {
    if (isShuttingDown) {
      app.log.warn(`[server] Already shutting down, ignoring ${signal}`);
      return;
    }

    isShuttingDown = true;
    app.log.info(`[server] Received ${signal}, starting graceful shutdown...`);

    // Set a timeout to force exit if graceful shutdown takes too long
    const forceExitTimeout = setTimeout(() => {
      app.log.error('[server] Shutdown timeout exceeded, forcing exit');
      process.exit(exitCode || 1);
    }, SHUTDOWN_TIMEOUT_MS);

    try {
      // Close analysis runner first (stops any running analyses)
      await closeAnalysisRunner();

      // Close session manager (stops active sessions)
      await closeSessionManager();

      // Close WebSocket connections
      closeWebSocketHandler();

      // Close server (releases the port)
      await app.close();

      // Close database
      closeDatabase();

      clearTimeout(forceExitTimeout);
      app.log.info('[server] Graceful shutdown complete');

      // Exit the process to ensure port is fully released
      process.exit(exitCode);
    } catch (error) {
      clearTimeout(forceExitTimeout);
      app.log.error({ error }, '[server] Error during shutdown');
      process.exit(1);
    }
  }

  // Register signal handlers for graceful shutdown
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });

  // Handle uncaught errors to ensure cleanup
  process.on('uncaughtException', (error) => {
    app.log.error({ error }, '[server] Uncaught exception');
    void shutdown('uncaughtException', 1);
  });

  process.on('unhandledRejection', (reason, promise) => {
    app.log.error({ reason, promise }, '[server] Unhandled promise rejection');
    void shutdown('unhandledRejection', 1);
  });

  // Start function
  async function start(): Promise<string> {
    try {
      const address = await app.listen({ port, host });
      app.log.info(`[server] Listening on ${address}`);
      return address;
    } catch (error) {
      app.log.error({ error }, '[server] Failed to start');
      throw error;
    }
  }

  // Stop function (for programmatic use - doesn't exit process)
  async function stop(): Promise<void> {
    if (isShuttingDown) {
      app.log.warn('[server] Already shutting down');
      return;
    }

    isShuttingDown = true;
    app.log.info('[server] Stopping server...');

    try {
      await closeAnalysisRunner();
      await closeSessionManager();
      closeWebSocketHandler();
      await app.close();
      closeDatabase();
      app.log.info('[server] Server stopped');
    } catch (error) {
      app.log.error({ error }, '[server] Error during stop');
      throw error;
    }
  }

  return { app, start, stop };
}

/**
 * Convenience function to create and start the server
 */
export async function startServer(options: ServerOptions = {}): Promise<SloppyServer> {
  const server = await createServer(options);
  await server.start();
  return server;
}

// Export types
export type { FastifyInstance };
