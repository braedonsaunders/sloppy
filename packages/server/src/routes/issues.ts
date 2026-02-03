/**
 * REST routes for issue management
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getDatabase, type IssueStatus } from '../db/database.js';
import { getWebSocketHandler } from '../websocket/handler.js';

// Request schemas
const SessionIdParamsSchema = z.object({
  id: z.string().min(1, 'Session ID is required'),
});

const IssueIdParamsSchema = z.object({
  id: z.string().min(1, 'Issue ID is required'),
});

const ListIssuesQuerySchema = z.object({
  status: z.enum(['detected', 'in_progress', 'fixed', 'approved', 'rejected', 'skipped']).optional(),
  type: z.enum(['lint', 'type', 'test', 'security', 'performance', 'style']).optional(),
  severity: z.enum(['error', 'warning', 'info', 'hint']).optional(),
});

const ApproveIssueBodySchema = z.object({
  comment: z.string().optional(),
});

const RejectIssueBodySchema = z.object({
  reason: z.string().min(1, 'Rejection reason is required'),
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
 * Register issue routes
 */
export async function registerIssueRoutes(app: FastifyInstance): Promise<void> {
  const db = getDatabase();
  const wsHandler = getWebSocketHandler();

  /**
   * GET /api/sessions/:id/issues - List issues for a session
   */
  app.get('/api/sessions/:id/issues', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const params = SessionIdParamsSchema.parse(request.params);
      const query = ListIssuesQuerySchema.parse(request.query);

      // Verify session exists
      const session = db.getSession(params.id);
      if (!session) {
        sendError(reply, 'Session not found', 404);
        return;
      }

      // Get issues with optional status filter
      let issues = db.listIssuesBySession(params.id, query.status as IssueStatus | undefined);

      // Apply additional filters
      if (query.type) {
        issues = issues.filter((issue) => issue.type === query.type);
      }
      if (query.severity) {
        issues = issues.filter((issue) => issue.severity === query.severity);
      }

      // Calculate summary stats
      const summary = {
        total: issues.length,
        byStatus: {
          detected: issues.filter((i) => i.status === 'detected').length,
          in_progress: issues.filter((i) => i.status === 'in_progress').length,
          fixed: issues.filter((i) => i.status === 'fixed').length,
          approved: issues.filter((i) => i.status === 'approved').length,
          rejected: issues.filter((i) => i.status === 'rejected').length,
          skipped: issues.filter((i) => i.status === 'skipped').length,
        },
        bySeverity: {
          error: issues.filter((i) => i.severity === 'error').length,
          warning: issues.filter((i) => i.severity === 'warning').length,
          info: issues.filter((i) => i.severity === 'info').length,
          hint: issues.filter((i) => i.severity === 'hint').length,
        },
      };

      sendSuccess(reply, { issues, summary });
    } catch (error) {
      if (error instanceof z.ZodError) {
        sendError(reply, `Validation error: ${error.errors.map((e) => e.message).join(', ')}`, 400);
        return;
      }

      app.log.error({ error }, 'Failed to list issues');
      sendError(reply, error instanceof Error ? error.message : 'Failed to list issues', 500);
    }
  });

  /**
   * GET /api/issues/:id - Get issue details
   */
  app.get('/api/issues/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const params = IssueIdParamsSchema.parse(request.params);
      const issue = db.getIssue(params.id);

      if (!issue) {
        sendError(reply, 'Issue not found', 404);
        return;
      }

      // Parse JSON fields for response
      const parsedIssue = {
        ...issue,
        context: issue.context ? JSON.parse(issue.context) as unknown : null,
      };

      sendSuccess(reply, parsedIssue);
    } catch (error) {
      if (error instanceof z.ZodError) {
        sendError(reply, `Validation error: ${error.errors.map((e) => e.message).join(', ')}`, 400);
        return;
      }

      app.log.error({ error }, 'Failed to get issue');
      sendError(reply, error instanceof Error ? error.message : 'Failed to get issue', 500);
    }
  });

  /**
   * POST /api/issues/:id/approve - Approve a fix (for approval mode)
   */
  app.post('/api/issues/:id/approve', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const params = IssueIdParamsSchema.parse(request.params);
      const body = ApproveIssueBodySchema.parse(request.body ?? {});

      const issue = db.getIssue(params.id);
      if (!issue) {
        sendError(reply, 'Issue not found', 404);
        return;
      }

      // Check if issue is in a state that can be approved
      if (issue.status !== 'fixed' && issue.status !== 'in_progress') {
        sendError(reply, `Cannot approve issue in status: ${issue.status}`, 409);
        return;
      }

      // Update issue status
      const updated = db.updateIssue(params.id, {
        status: 'approved',
        resolved_at: new Date().toISOString(),
      });

      if (!updated) {
        sendError(reply, 'Failed to update issue', 500);
        return;
      }

      app.log.info({ issueId: params.id, comment: body.comment }, 'Approved issue fix');

      // Broadcast update
      wsHandler.broadcastToSession(issue.session_id, {
        type: 'issue:updated',
        data: { issue: updated, action: 'approved' },
      });

      sendSuccess(reply, updated);
    } catch (error) {
      if (error instanceof z.ZodError) {
        sendError(reply, `Validation error: ${error.errors.map((e) => e.message).join(', ')}`, 400);
        return;
      }

      app.log.error({ error }, 'Failed to approve issue');
      sendError(reply, error instanceof Error ? error.message : 'Failed to approve issue', 500);
    }
  });

  /**
   * POST /api/issues/:id/reject - Reject a fix
   */
  app.post('/api/issues/:id/reject', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const params = IssueIdParamsSchema.parse(request.params);
      const body = RejectIssueBodySchema.parse(request.body);

      const issue = db.getIssue(params.id);
      if (!issue) {
        sendError(reply, 'Issue not found', 404);
        return;
      }

      // Check if issue is in a state that can be rejected
      if (issue.status !== 'fixed' && issue.status !== 'in_progress') {
        sendError(reply, `Cannot reject issue in status: ${issue.status}`, 409);
        return;
      }

      // Update issue status and store rejection reason in context
      const existingContext = issue.context ? JSON.parse(issue.context) as Record<string, unknown> : {};
      const updatedContext = {
        ...existingContext,
        rejectionReason: body.reason,
        rejectedAt: new Date().toISOString(),
      };

      // Update issue - revert to detected status so it can be retried
      const updated = db.updateIssue(params.id, {
        status: 'rejected',
        fix_content: null, // Clear the rejected fix
      });

      if (!updated) {
        sendError(reply, 'Failed to update issue', 500);
        return;
      }

      // Update context separately (since updateIssue doesn't handle context)
      db.getRawDb().prepare('UPDATE issues SET context = ? WHERE id = ?').run(
        JSON.stringify(updatedContext),
        params.id
      );

      const finalIssue = db.getIssue(params.id);

      app.log.info({ issueId: params.id, reason: body.reason }, 'Rejected issue fix');

      // Broadcast update
      wsHandler.broadcastToSession(issue.session_id, {
        type: 'issue:updated',
        data: { issue: finalIssue, action: 'rejected', reason: body.reason },
      });

      sendSuccess(reply, finalIssue);
    } catch (error) {
      if (error instanceof z.ZodError) {
        sendError(reply, `Validation error: ${error.errors.map((e) => e.message).join(', ')}`, 400);
        return;
      }

      app.log.error({ error }, 'Failed to reject issue');
      sendError(reply, error instanceof Error ? error.message : 'Failed to reject issue', 500);
    }
  });

  /**
   * POST /api/issues/:id/skip - Skip an issue
   */
  app.post('/api/issues/:id/skip', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const params = IssueIdParamsSchema.parse(request.params);

      const issue = db.getIssue(params.id);
      if (!issue) {
        sendError(reply, 'Issue not found', 404);
        return;
      }

      // Check if issue can be skipped
      if (issue.status === 'fixed' || issue.status === 'approved') {
        sendError(reply, `Cannot skip issue in status: ${issue.status}`, 409);
        return;
      }

      // Update issue status
      const updated = db.updateIssue(params.id, {
        status: 'skipped',
      });

      if (!updated) {
        sendError(reply, 'Failed to update issue', 500);
        return;
      }

      app.log.info({ issueId: params.id }, 'Skipped issue');

      // Broadcast update
      wsHandler.broadcastToSession(issue.session_id, {
        type: 'issue:updated',
        data: { issue: updated, action: 'skipped' },
      });

      sendSuccess(reply, updated);
    } catch (error) {
      if (error instanceof z.ZodError) {
        sendError(reply, `Validation error: ${error.errors.map((e) => e.message).join(', ')}`, 400);
        return;
      }

      app.log.error({ error }, 'Failed to skip issue');
      sendError(reply, error instanceof Error ? error.message : 'Failed to skip issue', 500);
    }
  });

  app.log.info('[routes] Issue routes registered');
}
