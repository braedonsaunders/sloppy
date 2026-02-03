/**
 * REST routes for commit management
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getDatabase } from '../db/database.js';
import { getWebSocketHandler } from '../websocket/handler.js';

// Request schemas
const SessionIdParamsSchema = z.object({
  id: z.string().min(1, 'Session ID is required'),
});

const CommitIdParamsSchema = z.object({
  id: z.string().min(1, 'Commit ID is required'),
});

const ListCommitsQuerySchema = z.object({
  includeReverted: z
    .string()
    .optional()
    .transform((val) => val !== 'false'),
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
 * Register commit routes
 */
export async function registerCommitRoutes(app: FastifyInstance): Promise<void> {
  const db = getDatabase();
  const wsHandler = getWebSocketHandler();

  /**
   * GET /api/sessions/:id/commits - List commits for a session
   */
  app.get('/api/sessions/:id/commits', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const params = SessionIdParamsSchema.parse(request.params);
      const query = ListCommitsQuerySchema.parse(request.query);

      // Verify session exists
      const session = db.getSession(params.id);
      if (!session) {
        sendError(reply, 'Session not found', 404);
        return;
      }

      // Get commits
      const commits = db.listCommitsBySession(params.id, query.includeReverted);

      // Calculate summary
      const allCommits = db.listCommitsBySession(params.id, true);
      const summary = {
        total: allCommits.length,
        active: allCommits.filter((c) => !c.reverted).length,
        reverted: allCommits.filter((c) => c.reverted).length,
      };

      sendSuccess(reply, { commits, summary });
    } catch (error) {
      if (error instanceof z.ZodError) {
        sendError(reply, `Validation error: ${error.errors.map((e) => e.message).join(', ')}`, 400);
        return;
      }

      app.log.error({ error }, 'Failed to list commits');
      sendError(reply, error instanceof Error ? error.message : 'Failed to list commits', 500);
    }
  });

  /**
   * GET /api/commits/:id - Get commit details
   */
  app.get('/api/commits/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const params = CommitIdParamsSchema.parse(request.params);
      const commit = db.getCommit(params.id);

      if (!commit) {
        sendError(reply, 'Commit not found', 404);
        return;
      }

      // Include related issue if available
      let issue = null;
      if (commit.issue_id) {
        issue = db.getIssue(commit.issue_id);
      }

      sendSuccess(reply, { commit, issue });
    } catch (error) {
      if (error instanceof z.ZodError) {
        sendError(reply, `Validation error: ${error.errors.map((e) => e.message).join(', ')}`, 400);
        return;
      }

      app.log.error({ error }, 'Failed to get commit');
      sendError(reply, error instanceof Error ? error.message : 'Failed to get commit', 500);
    }
  });

  /**
   * POST /api/commits/:id/revert - Revert a commit
   *
   * Note: This endpoint marks the commit as reverted in the database.
   * The actual git revert operation should be performed by the orchestrator
   * or a separate git service, which will then call this endpoint with the
   * revert commit hash.
   */
  app.post('/api/commits/:id/revert', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const params = CommitIdParamsSchema.parse(request.params);

      const commit = db.getCommit(params.id);
      if (!commit) {
        sendError(reply, 'Commit not found', 404);
        return;
      }

      // Check if already reverted
      if (commit.reverted) {
        sendError(reply, 'Commit already reverted', 409);
        return;
      }

      // In a real implementation, we would:
      // 1. Call the git service to perform the actual revert
      // 2. Get the revert commit hash
      // 3. Update the database

      // For now, we'll generate a placeholder revert hash
      // The orchestrator should handle the actual git operations
      const revertHash = `revert-${commit.hash.substring(0, 8)}-${Date.now().toString(36)}`;

      // Mark commit as reverted
      const updated = db.markCommitReverted(params.id, revertHash);
      if (!updated) {
        sendError(reply, 'Failed to revert commit', 500);
        return;
      }

      // If this commit was associated with an issue, update the issue status
      if (commit.issue_id) {
        const issue = db.getIssue(commit.issue_id);
        if (issue && (issue.status === 'fixed' || issue.status === 'approved')) {
          db.updateIssue(commit.issue_id, {
            status: 'detected',
            resolved_at: null,
          });
        }
      }

      app.log.info({ commitId: params.id, hash: commit.hash }, 'Reverted commit');

      // Broadcast update
      wsHandler.broadcastToSession(commit.session_id, {
        type: 'commit:reverted',
        data: { commit: updated, revertHash },
      });

      sendSuccess(reply, { commit: updated, revertHash });
    } catch (error) {
      if (error instanceof z.ZodError) {
        sendError(reply, `Validation error: ${error.errors.map((e) => e.message).join(', ')}`, 400);
        return;
      }

      app.log.error({ error }, 'Failed to revert commit');
      sendError(reply, error instanceof Error ? error.message : 'Failed to revert commit', 500);
    }
  });

  /**
   * POST /api/sessions/:id/revert-all - Revert all commits for a session
   *
   * Reverts all non-reverted commits for a session in reverse chronological order.
   */
  app.post('/api/sessions/:id/revert-all', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const params = SessionIdParamsSchema.parse(request.params);

      // Verify session exists
      const session = db.getSession(params.id);
      if (!session) {
        sendError(reply, 'Session not found', 404);
        return;
      }

      // Get all non-reverted commits (already in reverse chronological order)
      const commits = db.listCommitsBySession(params.id, false);

      if (commits.length === 0) {
        sendSuccess(reply, {
          reverted: 0,
          commits: [],
          message: 'No commits to revert',
        });
        return;
      }

      // Revert each commit in a transaction
      const revertedCommits: Array<{ commitId: string; hash: string; revertHash: string }> = [];

      db.transaction(() => {
        for (const commit of commits) {
          const revertHash = `revert-${commit.hash.substring(0, 8)}-${Date.now().toString(36)}`;
          const updated = db.markCommitReverted(commit.id, revertHash);

          if (updated) {
            revertedCommits.push({
              commitId: commit.id,
              hash: commit.hash,
              revertHash,
            });

            // Reset associated issue status
            if (commit.issue_id) {
              const issue = db.getIssue(commit.issue_id);
              if (issue && (issue.status === 'fixed' || issue.status === 'approved')) {
                db.updateIssue(commit.issue_id, {
                  status: 'detected',
                  resolved_at: null,
                });
              }
            }
          }
        }
      });

      app.log.info(
        { sessionId: params.id, revertedCount: revertedCommits.length },
        'Reverted all commits for session'
      );

      // Broadcast update
      wsHandler.broadcastToSession(params.id, {
        type: 'commit:reverted',
        data: { action: 'revert-all', commits: revertedCommits },
      });

      sendSuccess(reply, {
        reverted: revertedCommits.length,
        commits: revertedCommits,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        sendError(reply, `Validation error: ${error.errors.map((e) => e.message).join(', ')}`, 400);
        return;
      }

      app.log.error({ error }, 'Failed to revert all commits');
      sendError(reply, error instanceof Error ? error.message : 'Failed to revert all commits', 500);
    }
  });

  app.log.info('[routes] Commit routes registered');
}
