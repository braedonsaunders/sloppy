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
import { registerSessionRoutes } from './routes/sessions.js';
import { registerIssueRoutes } from './routes/issues.js';
import { registerCommitRoutes } from './routes/commits.js';
import { registerMetricsRoutes } from './routes/metrics.js';

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
    port = 3000,
    dbPath = join(__dirname, '..', 'data', 'sloppy.db'),
    staticDir = join(__dirname, '..', '..', 'ui', 'dist'),
    corsOrigin = true,
    logLevel = 'info',
  } = options;

  // Create Fastify instance
  const app = Fastify({
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
      decorateReply: false,
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

  async function shutdown(signal: string): Promise<void> {
    if (isShuttingDown) {
      app.log.warn(`[server] Already shutting down, ignoring ${signal}`);
      return;
    }

    isShuttingDown = true;
    app.log.info(`[server] Received ${signal}, starting graceful shutdown...`);

    try {
      // Close session manager first (stops active sessions)
      await closeSessionManager();

      // Close WebSocket connections
      closeWebSocketHandler();

      // Close server
      await app.close();

      // Close database
      closeDatabase();

      app.log.info('[server] Graceful shutdown complete');
    } catch (error) {
      app.log.error({ error }, '[server] Error during shutdown');
      throw error;
    }
  }

  // Register signal handlers
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
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

  // Stop function
  async function stop(): Promise<void> {
    await shutdown('manual');
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
