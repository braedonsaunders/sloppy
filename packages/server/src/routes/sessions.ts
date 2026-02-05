/**
 * REST routes for session management
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getSessionManager, CreateSessionSchema } from '../services/session-manager.js';
import { getDatabase } from '../db/database.js';

// Request schemas
const SessionIdParamsSchema = z.object({
  id: z.string().min(1, 'Session ID is required'),
});

const ListSessionsQuerySchema = z.object({
  status: z.enum(['pending', 'running', 'paused', 'completed', 'failed', 'stopped']).optional(),
});

// Response helpers
function sendSuccess<T>(reply: FastifyReply, data: T, statusCode = 200): void {
  void reply.code(statusCode).send({
    success: true,
    data,
  });
}

function sendError(reply: FastifyReply, message: string, statusCode = 400): void {
  void reply.code(statusCode).send({
    success: false,
    error: { message },
  });
}

/**
 * Register session routes
 */
export async function registerSessionRoutes(app: FastifyInstance): Promise<void> {
  const sessionManager = getSessionManager();

  /**
   * POST /api/sessions - Create a new cleaning session
   */
  app.post('/api/sessions', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = CreateSessionSchema.parse(request.body);
      const session = await sessionManager.createSession(body);

      app.log.info({ sessionId: session.id }, 'Created new session');
      sendSuccess(reply, session, 201);
    } catch (error) {
      if (error instanceof z.ZodError) {
        sendError(reply, `Validation error: ${error.errors.map((e) => e.message).join(', ')}`, 400);
        return;
      }

      app.log.error({ error }, 'Failed to create session');
      sendError(reply, error instanceof Error ? error.message : 'Failed to create session', 500);
    }
  });

  /**
   * GET /api/sessions - List all sessions
   */
  app.get('/api/sessions', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = ListSessionsQuerySchema.parse(request.query);
      const sessions = await sessionManager.listSessions(query.status);

      sendSuccess(reply, { sessions, count: sessions.length });
    } catch (error) {
      if (error instanceof z.ZodError) {
        sendError(reply, `Validation error: ${error.errors.map((e) => e.message).join(', ')}`, 400);
        return;
      }

      app.log.error({ error }, 'Failed to list sessions');
      sendError(reply, error instanceof Error ? error.message : 'Failed to list sessions', 500);
    }
  });

  /**
   * GET /api/sessions/:id - Get session details
   */
  app.get('/api/sessions/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const params = SessionIdParamsSchema.parse(request.params);
      const session = await sessionManager.getSession(params.id);

      if (!session) {
        sendError(reply, 'Session not found', 404);
        return;
      }

      // Include issues, commits, and metrics
      const issues = sessionManager.getSessionIssues(params.id);
      const commits = sessionManager.getSessionCommits(params.id);
      const metrics = sessionManager.getSessionMetrics(params.id);

      sendSuccess(reply, {
        session,
        issues,
        commits,
        metrics,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        sendError(reply, `Validation error: ${error.errors.map((e) => e.message).join(', ')}`, 400);
        return;
      }

      app.log.error({ error }, 'Failed to get session');
      sendError(reply, error instanceof Error ? error.message : 'Failed to get session', 500);
    }
  });

  /**
   * POST /api/sessions/:id/start - Start a session
   */
  app.post('/api/sessions/:id/start', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const params = SessionIdParamsSchema.parse(request.params);
      const session = await sessionManager.startSession(params.id);

      app.log.info({ sessionId: params.id }, 'Started session');
      sendSuccess(reply, session);
    } catch (error) {
      if (error instanceof z.ZodError) {
        sendError(reply, `Validation error: ${error.errors.map((e) => e.message).join(', ')}`, 400);
        return;
      }

      const message = error instanceof Error ? error.message : 'Failed to start session';
      if (message.includes('not found')) {
        sendError(reply, message, 404);
        return;
      }
      if (message.includes('Cannot start')) {
        sendError(reply, message, 409);
        return;
      }

      app.log.error({ error }, 'Failed to start session');
      sendError(reply, message, 500);
    }
  });

  /**
   * POST /api/sessions/:id/pause - Pause a session
   */
  app.post('/api/sessions/:id/pause', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const params = SessionIdParamsSchema.parse(request.params);
      const session = await sessionManager.pauseSession(params.id);

      app.log.info({ sessionId: params.id }, 'Paused session');
      sendSuccess(reply, session);
    } catch (error) {
      if (error instanceof z.ZodError) {
        sendError(reply, `Validation error: ${error.errors.map((e) => e.message).join(', ')}`, 400);
        return;
      }

      const message = error instanceof Error ? error.message : 'Failed to pause session';
      if (message.includes('not found')) {
        sendError(reply, message, 404);
        return;
      }
      if (message.includes('Cannot pause')) {
        sendError(reply, message, 409);
        return;
      }

      app.log.error({ error }, 'Failed to pause session');
      sendError(reply, message, 500);
    }
  });

  /**
   * POST /api/sessions/:id/resume - Resume a paused session
   */
  app.post('/api/sessions/:id/resume', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const params = SessionIdParamsSchema.parse(request.params);
      const session = await sessionManager.resumeSession(params.id);

      app.log.info({ sessionId: params.id }, 'Resumed session');
      sendSuccess(reply, session);
    } catch (error) {
      if (error instanceof z.ZodError) {
        sendError(reply, `Validation error: ${error.errors.map((e) => e.message).join(', ')}`, 400);
        return;
      }

      const message = error instanceof Error ? error.message : 'Failed to resume session';
      if (message.includes('not found')) {
        sendError(reply, message, 404);
        return;
      }
      if (message.includes('Cannot resume')) {
        sendError(reply, message, 409);
        return;
      }

      app.log.error({ error }, 'Failed to resume session');
      sendError(reply, message, 500);
    }
  });

  /**
   * POST /api/sessions/:id/stop - Stop a session
   */
  app.post('/api/sessions/:id/stop', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const params = SessionIdParamsSchema.parse(request.params);
      const session = await sessionManager.stopSession(params.id);

      app.log.info({ sessionId: params.id }, 'Stopped session');
      sendSuccess(reply, session);
    } catch (error) {
      if (error instanceof z.ZodError) {
        sendError(reply, `Validation error: ${error.errors.map((e) => e.message).join(', ')}`, 400);
        return;
      }

      const message = error instanceof Error ? error.message : 'Failed to stop session';
      if (message.includes('not found')) {
        sendError(reply, message, 404);
        return;
      }
      if (message.includes('already ended')) {
        sendError(reply, message, 409);
        return;
      }

      app.log.error({ error }, 'Failed to stop session');
      sendError(reply, message, 500);
    }
  });

  /**
   * GET /api/sessions/:id/stats - Get session stats
   */
  app.get('/api/sessions/:id/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const params = SessionIdParamsSchema.parse(request.params);
      const session = await sessionManager.getSession(params.id);

      if (!session) {
        sendError(reply, 'Session not found', 404);
        return;
      }

      // Return session stats (stats already has the right field names)
      sendSuccess(reply, {
        issuesFound: session.stats.issuesFound,
        issuesResolved: session.stats.issuesResolved,
        commitsCreated: session.stats.commitsCreated,
        elapsedTime: session.stats.elapsedTime,
        estimatedTimeRemaining: null,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        sendError(reply, `Validation error: ${error.errors.map((e) => e.message).join(', ')}`, 400);
        return;
      }

      app.log.error({ error }, 'Failed to get session stats');
      sendError(reply, error instanceof Error ? error.message : 'Failed to get session stats', 500);
    }
  });

  /**
   * GET /api/sessions/:id/activity - Get session activity log
   */
  app.get('/api/sessions/:id/activity', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const params = SessionIdParamsSchema.parse(request.params);
      const session = await sessionManager.getSession(params.id);

      if (!session) {
        sendError(reply, 'Session not found', 404);
        return;
      }

      const db = getDatabase();
      const activities = db.listActivitiesBySession(params.id);
      sendSuccess(reply, activities);
    } catch (error) {
      if (error instanceof z.ZodError) {
        sendError(reply, `Validation error: ${error.errors.map((e) => e.message).join(', ')}`, 400);
        return;
      }

      app.log.error({ error }, 'Failed to get session activity');
      sendError(reply, error instanceof Error ? error.message : 'Failed to get session activity', 500);
    }
  });

  /**
   * DELETE /api/sessions/:id - Delete a session
   */
  app.delete('/api/sessions/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const params = SessionIdParamsSchema.parse(request.params);
      const deleted = await sessionManager.deleteSession(params.id);

      if (!deleted) {
        sendError(reply, 'Session not found', 404);
        return;
      }

      app.log.info({ sessionId: params.id }, 'Deleted session');
      sendSuccess(reply, { deleted: true });
    } catch (error) {
      if (error instanceof z.ZodError) {
        sendError(reply, `Validation error: ${error.errors.map((e) => e.message).join(', ')}`, 400);
        return;
      }

      app.log.error({ error }, 'Failed to delete session');
      sendError(reply, error instanceof Error ? error.message : 'Failed to delete session', 500);
    }
  });

  app.log.info('[routes] Session routes registered');
}
