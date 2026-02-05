/**
 * Watch mode routes
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getWatchService } from '../services/watch-service.js';

function sendSuccess<T>(reply: FastifyReply, data: T, statusCode = 200): void {
  void reply.code(statusCode).send({ success: true, data });
}

function sendError(reply: FastifyReply, message: string, statusCode = 400): void {
  void reply.code(statusCode).send({ success: false, error: { message } });
}

export async function registerWatchRoutes(app: FastifyInstance): Promise<void> {
  const watchService = getWatchService();

  // Start watching
  app.post('/api/watch/start', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = z.object({
        repoPath: z.string().min(1),
      }).parse(request.body);

      const session = await watchService.startWatching(body.repoPath);
      sendSuccess(reply, {
        id: session.id,
        repoPath: session.repoPath,
        status: session.status,
        startedAt: session.startedAt,
      }, 201);
    } catch (error) {
      sendError(reply, error instanceof Error ? error.message : 'Failed to start watch', 500);
    }
  });

  // Stop watching
  app.post('/api/watch/:id/stop', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const stopped = watchService.stopWatching(id);
      if (!stopped) {
        sendError(reply, 'Watch session not found', 404);
        return;
      }
      sendSuccess(reply, { stopped: true });
    } catch (error) {
      sendError(reply, error instanceof Error ? error.message : 'Failed to stop watch', 500);
    }
  });

  // Pause watching
  app.post('/api/watch/:id/pause', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const paused = watchService.pauseWatching(id);
    if (!paused) {
      sendError(reply, 'Watch session not found or not active', 404);
      return;
    }
    sendSuccess(reply, { paused: true });
  });

  // Resume watching
  app.post('/api/watch/:id/resume', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const resumed = watchService.resumeWatching(id);
    if (!resumed) {
      sendError(reply, 'Watch session not found or not paused', 404);
      return;
    }
    sendSuccess(reply, { resumed: true });
  });

  // List watch sessions
  app.get('/api/watch', async (_request: FastifyRequest, reply: FastifyReply) => {
    const sessions = watchService.listSessions();
    sendSuccess(reply, { sessions });
  });

  // Get watch session
  app.get('/api/watch/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const session = watchService.getSession(id);
    if (!session) {
      sendError(reply, 'Watch session not found', 404);
      return;
    }
    sendSuccess(reply, {
      id: session.id,
      repoPath: session.repoPath,
      status: session.status,
      startedAt: session.startedAt,
      issuesFixed: session.issuesFixed,
      lastActivity: session.lastActivity,
      changedFiles: Array.from(session.changedFiles),
    });
  });

  app.log.info('[routes] Watch routes registered');
}
