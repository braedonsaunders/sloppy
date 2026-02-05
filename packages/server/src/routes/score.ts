/**
 * REST routes for Sloppy Score
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getDatabase } from '../db/database.js';
import { computeAndSaveScore } from '../services/scoring.js';

// Request schemas
const SessionIdParamsSchema = z.object({
  id: z.string().min(1, 'Session ID is required'),
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
 * Parse breakdown JSON from a score record
 */
function parseScoreBreakdown(breakdown: string): Record<string, unknown> {
  try {
    return JSON.parse(breakdown) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Register score routes
 */
export async function registerScoreRoutes(app: FastifyInstance): Promise<void> {
  const db = getDatabase();

  /**
   * GET /api/sessions/:id/score - Get latest score for a session
   */
  app.get('/api/sessions/:id/score', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const params = SessionIdParamsSchema.parse(request.params);

      // Verify session exists
      const session = db.getSession(params.id);
      if (!session) {
        sendError(reply, 'Session not found', 404);
        return;
      }

      const score = db.getLatestScore(params.id);

      if (!score) {
        sendSuccess(reply, { score: null });
        return;
      }

      sendSuccess(reply, {
        score: {
          ...score,
          breakdown: parseScoreBreakdown(score.breakdown),
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        sendError(reply, `Validation error: ${error.errors.map((e) => e.message).join(', ')}`, 400);
        return;
      }

      app.log.error({ error }, 'Failed to get score');
      sendError(reply, error instanceof Error ? error.message : 'Failed to get score', 500);
    }
  });

  /**
   * POST /api/sessions/:id/score - Compute and save a new score
   */
  app.post('/api/sessions/:id/score', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const params = SessionIdParamsSchema.parse(request.params);

      // Verify session exists
      const session = db.getSession(params.id);
      if (!session) {
        sendError(reply, 'Session not found', 404);
        return;
      }

      // Compute and save the score
      const score = computeAndSaveScore(db, params.id);

      sendSuccess(reply, {
        score: {
          ...score,
          breakdown: parseScoreBreakdown(score.breakdown),
        },
      }, 201);
    } catch (error) {
      if (error instanceof z.ZodError) {
        sendError(reply, `Validation error: ${error.errors.map((e) => e.message).join(', ')}`, 400);
        return;
      }

      app.log.error({ error }, 'Failed to compute score');
      sendError(reply, error instanceof Error ? error.message : 'Failed to compute score', 500);
    }
  });

  app.log.info('[routes] Score routes registered');
}
