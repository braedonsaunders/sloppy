/**
 * REST routes for metrics
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getDatabase } from '../db/database.js';

// Request schemas
const SessionIdParamsSchema = z.object({
  id: z.string().min(1, 'Session ID is required'),
});

const MetricsQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : undefined))
    .pipe(z.number().int().min(1).max(1000).optional()),
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
 * Register metrics routes
 */
export async function registerMetricsRoutes(app: FastifyInstance): Promise<void> {
  const db = getDatabase();

  /**
   * GET /api/sessions/:id/metrics - Get metrics history for a session
   */
  app.get('/api/sessions/:id/metrics', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const params = SessionIdParamsSchema.parse(request.params);
      const query = MetricsQuerySchema.parse(request.query);

      // Verify session exists
      const session = db.getSession(params.id);
      if (!session) {
        sendError(reply, 'Session not found', 404);
        return;
      }

      // Get all metrics for the session
      let metrics = db.listMetricsBySession(params.id);

      // Apply time filters
      if (query.from) {
        const fromTime = new Date(query.from).getTime();
        metrics = metrics.filter((m) => new Date(m.timestamp).getTime() >= fromTime);
      }

      if (query.to) {
        const toTime = new Date(query.to).getTime();
        metrics = metrics.filter((m) => new Date(m.timestamp).getTime() <= toTime);
      }

      // Apply limit (from the end to get most recent)
      if (query.limit && metrics.length > query.limit) {
        metrics = metrics.slice(-query.limit);
      }

      // Parse custom_metrics JSON for each metric
      const parsedMetrics = metrics.map((m) => ({
        ...m,
        custom_metrics: m.custom_metrics ? JSON.parse(m.custom_metrics) as unknown : null,
      }));

      // Calculate summary stats
      const latest = parsedMetrics[parsedMetrics.length - 1];
      const first = parsedMetrics[0];

      const summary = latest
        ? {
            totalIssues: latest.total_issues,
            resolvedIssues: latest.resolved_issues,
            resolutionRate:
              latest.total_issues > 0
                ? Math.round((latest.resolved_issues / latest.total_issues) * 100)
                : 0,
            testCount: latest.test_count,
            testsPassing: latest.tests_passing,
            testPassRate:
              latest.test_count && latest.tests_passing
                ? Math.round((latest.tests_passing / latest.test_count) * 100)
                : null,
            lintErrors: latest.lint_errors,
            typeErrors: latest.type_errors,
            coveragePercent: latest.coverage_percent,
            // Progress since start
            progress:
              first && latest
                ? {
                    issuesResolved: latest.resolved_issues - (first.resolved_issues ?? 0),
                    lintErrorsFixed:
                      first.lint_errors !== null && latest.lint_errors !== null
                        ? first.lint_errors - latest.lint_errors
                        : null,
                    typeErrorsFixed:
                      first.type_errors !== null && latest.type_errors !== null
                        ? first.type_errors - latest.type_errors
                        : null,
                    coverageChange:
                      first.coverage_percent !== null && latest.coverage_percent !== null
                        ? latest.coverage_percent - first.coverage_percent
                        : null,
                  }
                : null,
          }
        : null;

      sendSuccess(reply, {
        metrics: parsedMetrics,
        summary,
        count: parsedMetrics.length,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        sendError(reply, `Validation error: ${error.errors.map((e) => e.message).join(', ')}`, 400);
        return;
      }

      app.log.error({ error }, 'Failed to get metrics');
      sendError(reply, error instanceof Error ? error.message : 'Failed to get metrics', 500);
    }
  });

  /**
   * GET /api/sessions/:id/metrics/latest - Get latest metrics for a session
   */
  app.get('/api/sessions/:id/metrics/latest', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const params = SessionIdParamsSchema.parse(request.params);

      // Verify session exists
      const session = db.getSession(params.id);
      if (!session) {
        sendError(reply, 'Session not found', 404);
        return;
      }

      const metric = db.getLatestMetric(params.id);

      if (!metric) {
        sendSuccess(reply, { metric: null });
        return;
      }

      // Parse custom_metrics JSON
      const parsedMetric = {
        ...metric,
        custom_metrics: metric.custom_metrics ? JSON.parse(metric.custom_metrics) as unknown : null,
      };

      sendSuccess(reply, { metric: parsedMetric });
    } catch (error) {
      if (error instanceof z.ZodError) {
        sendError(reply, `Validation error: ${error.errors.map((e) => e.message).join(', ')}`, 400);
        return;
      }

      app.log.error({ error }, 'Failed to get latest metrics');
      sendError(reply, error instanceof Error ? error.message : 'Failed to get latest metrics', 500);
    }
  });

  /**
   * GET /api/sessions/:id/metrics/summary - Get metrics summary for a session
   */
  app.get('/api/sessions/:id/metrics/summary', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const params = SessionIdParamsSchema.parse(request.params);

      // Verify session exists
      const session = db.getSession(params.id);
      if (!session) {
        sendError(reply, 'Session not found', 404);
        return;
      }

      // Get session stats from database
      const stats = db.getSessionStats(params.id);

      // Get first and latest metrics
      const metrics = db.listMetricsBySession(params.id);
      const first = metrics[0];
      const latest = metrics[metrics.length - 1];

      // Build comprehensive summary
      const summary = {
        session: {
          id: session.id,
          status: session.status,
          duration: session.started_at
            ? {
                started: session.started_at,
                ended: session.ended_at,
                minutes: session.ended_at
                  ? Math.round(
                      (new Date(session.ended_at).getTime() - new Date(session.started_at).getTime()) /
                        60000
                    )
                  : Math.round(
                      (Date.now() - new Date(session.started_at).getTime()) / 60000
                    ),
              }
            : null,
        },
        issues: {
          total: stats.issuesFound,
          resolved: stats.issuesResolved,
          pending: stats.issuesFound - stats.issuesResolved,
          resolutionRate:
            stats.issuesFound > 0
              ? Math.round((stats.issuesResolved / stats.issuesFound) * 100)
              : 0,
        },
        commits: {
          total: stats.commitsCreated,
          active: stats.commitsCreated - stats.revertedCommits,
          reverted: stats.revertedCommits,
        },
        codeQuality: latest
          ? {
              lintErrors: latest.lint_errors,
              typeErrors: latest.type_errors,
              coveragePercent: latest.coverage_percent,
            }
          : null,
        tests: latest
          ? {
              total: latest.test_count,
              passing: latest.tests_passing,
              passRate:
                latest.test_count && latest.tests_passing
                  ? Math.round((latest.tests_passing / latest.test_count) * 100)
                  : null,
            }
          : null,
        improvement:
          first && latest
            ? {
                lintErrorsFixed:
                  first.lint_errors !== null && latest.lint_errors !== null
                    ? first.lint_errors - latest.lint_errors
                    : null,
                typeErrorsFixed:
                  first.type_errors !== null && latest.type_errors !== null
                    ? first.type_errors - latest.type_errors
                    : null,
                coverageGain:
                  first.coverage_percent !== null && latest.coverage_percent !== null
                    ? Math.round((latest.coverage_percent - first.coverage_percent) * 100) / 100
                    : null,
              }
            : null,
        metricsHistory: {
          count: metrics.length,
          firstRecorded: first?.timestamp ?? null,
          lastRecorded: latest?.timestamp ?? null,
        },
      };

      sendSuccess(reply, summary);
    } catch (error) {
      if (error instanceof z.ZodError) {
        sendError(reply, `Validation error: ${error.errors.map((e) => e.message).join(', ')}`, 400);
        return;
      }

      app.log.error({ error }, 'Failed to get metrics summary');
      sendError(reply, error instanceof Error ? error.message : 'Failed to get metrics summary', 500);
    }
  });

  app.log.info('[routes] Metrics routes registered');
}
