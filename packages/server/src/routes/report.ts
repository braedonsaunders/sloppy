/**
 * Report routes - Generate shareable HTML/JSON reports for sessions
 * Viral mechanic: shareable analysis reports
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getDatabase } from '../db/database.js';
import { computeScore } from '../services/scoring.js';

const SessionIdParamsSchema = z.object({
  id: z.string().min(1, 'Session ID is required'),
});

const ReportQuerySchema = z.object({
  format: z.enum(['html', 'json']).optional().default('html'),
});

function sendError(reply: FastifyReply, message: string, statusCode = 400): void {
  void reply.code(statusCode).send({
    success: false,
    error: { message },
  });
}

function generateHTMLReport(data: {
  session: Record<string, unknown>;
  issues: Array<Record<string, unknown>>;
  commits: Array<Record<string, unknown>>;
  score: { score: number; breakdown: Record<string, unknown> } | null;
  stats: Record<string, unknown>;
}): string {
  const { session, issues, score, stats } = data;
  const scoreValue = score?.score ?? 0;
  const issuesByType: Record<string, number> = {};
  const issuesBySeverity: Record<string, number> = {};

  for (const issue of issues) {
    const type = issue.type as string;
    const severity = issue.severity as string;
    issuesByType[type] = (issuesByType[type] ?? 0) + 1;
    issuesBySeverity[severity] = (issuesBySeverity[severity] ?? 0) + 1;
  }

  const resolvedCount = issues.filter(
    (i) => i.status === 'fixed' || i.status === 'approved'
  ).length;

  const getScoreColor = (s: number): string => {
    if (s >= 90) return '#22c55e';
    if (s >= 70) return '#eab308';
    if (s >= 50) return '#f97316';
    return '#ef4444';
  };

  const severityColor: Record<string, string> = {
    error: '#ef4444',
    warning: '#f97316',
    info: '#3b82f6',
    hint: '#6b7280',
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sloppy Report - ${escapeHtml(session.repo_path as string)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0f; color: #e0e0e0; padding: 2rem; max-width: 900px; margin: 0 auto; }
    .header { text-align: center; margin-bottom: 3rem; padding: 2rem; background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border-radius: 16px; border: 1px solid #2a2a4a; }
    .logo { font-size: 2rem; font-weight: 800; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: 0.5rem; }
    .repo { font-size: 0.9rem; color: #888; font-family: monospace; }
    .score-ring { width: 160px; height: 160px; margin: 2rem auto; position: relative; }
    .score-ring svg { transform: rotate(-90deg); }
    .score-ring .value { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 2.5rem; font-weight: 800; color: ${getScoreColor(scoreValue)}; }
    .score-ring .label { position: absolute; top: 65%; left: 50%; transform: translate(-50%, 0); font-size: 0.75rem; color: #888; text-transform: uppercase; letter-spacing: 1px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
    .card { background: #12121a; border: 1px solid #2a2a4a; border-radius: 12px; padding: 1.5rem; }
    .card .number { font-size: 2rem; font-weight: 700; }
    .card .label { font-size: 0.8rem; color: #888; margin-top: 0.25rem; }
    h2 { font-size: 1.3rem; margin: 2rem 0 1rem; padding-bottom: 0.5rem; border-bottom: 1px solid #2a2a4a; }
    .issue-list { list-style: none; }
    .issue-item { padding: 1rem; border: 1px solid #2a2a4a; border-radius: 8px; margin-bottom: 0.5rem; background: #12121a; }
    .issue-header { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem; }
    .badge { font-size: 0.7rem; padding: 2px 8px; border-radius: 4px; font-weight: 600; text-transform: uppercase; }
    .issue-desc { font-size: 0.9rem; color: #ccc; }
    .issue-file { font-size: 0.8rem; color: #888; font-family: monospace; margin-top: 0.25rem; }
    .breakdown-bar { display: flex; align-items: center; gap: 0.75rem; padding: 0.5rem 0; }
    .breakdown-label { min-width: 120px; font-size: 0.85rem; color: #aaa; }
    .breakdown-track { flex: 1; height: 8px; background: #2a2a4a; border-radius: 4px; overflow: hidden; }
    .breakdown-fill { height: 100%; border-radius: 4px; transition: width 0.3s; }
    .breakdown-value { min-width: 40px; text-align: right; font-size: 0.85rem; font-weight: 600; }
    .footer { text-align: center; margin-top: 3rem; padding-top: 1.5rem; border-top: 1px solid #2a2a4a; color: #555; font-size: 0.8rem; }
    .footer a { color: #667eea; text-decoration: none; }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo">Sloppy Report</div>
    <div class="repo">${escapeHtml(session.repo_path as string)}</div>
    <div class="score-ring">
      <svg width="160" height="160" viewBox="0 0 160 160">
        <circle cx="80" cy="80" r="70" fill="none" stroke="#2a2a4a" stroke-width="10"/>
        <circle cx="80" cy="80" r="70" fill="none" stroke="${getScoreColor(scoreValue)}" stroke-width="10"
          stroke-dasharray="${(scoreValue / 100) * 440} 440" stroke-linecap="round"/>
      </svg>
      <div class="value">${scoreValue}</div>
      <div class="label">Sloppy Score</div>
    </div>
  </div>

  <div class="grid">
    <div class="card">
      <div class="number">${issues.length}</div>
      <div class="label">Issues Found</div>
    </div>
    <div class="card">
      <div class="number" style="color: #22c55e">${resolvedCount}</div>
      <div class="label">Issues Resolved</div>
    </div>
    <div class="card">
      <div class="number">${(stats as Record<string, unknown>).commitsCreated ?? 0}</div>
      <div class="label">Commits Created</div>
    </div>
    <div class="card">
      <div class="number">${issues.length > 0 ? Math.round((resolvedCount / issues.length) * 100) : 100}%</div>
      <div class="label">Fix Rate</div>
    </div>
  </div>

  ${score?.breakdown ? `
  <h2>Score Breakdown</h2>
  <div class="card">
    ${Object.entries(score.breakdown as Record<string, number>).map(([key, value]) => `
    <div class="breakdown-bar">
      <div class="breakdown-label">${escapeHtml(key.replace(/([A-Z])/g, ' $1').replace(/^./, (s: string) => s.toUpperCase()))}</div>
      <div class="breakdown-track">
        <div class="breakdown-fill" style="width: ${value as number}%; background: ${getScoreColor(value as number)};"></div>
      </div>
      <div class="breakdown-value" style="color: ${getScoreColor(value as number)}">${value}</div>
    </div>`).join('')}
  </div>` : ''}

  <h2>Issues (${issues.length})</h2>
  ${issues.length === 0 ? '<p style="color: #888; padding: 1rem;">No issues found. Your code is clean!</p>' : `
  <ul class="issue-list">
    ${issues.slice(0, 50).map((issue) => `
    <li class="issue-item">
      <div class="issue-header">
        <span class="badge" style="background: ${severityColor[issue.severity as string] ?? '#6b7280'}22; color: ${severityColor[issue.severity as string] ?? '#6b7280'}">${escapeHtml(issue.severity as string)}</span>
        <span class="badge" style="background: #667eea22; color: #667eea">${escapeHtml(issue.type as string)}</span>
        ${issue.status === 'fixed' || issue.status === 'approved' ? '<span class="badge" style="background: #22c55e22; color: #22c55e">fixed</span>' : ''}
      </div>
      <div class="issue-desc">${escapeHtml(issue.description as string)}</div>
      <div class="issue-file">${escapeHtml(issue.file_path as string)}${issue.line_start ? `:${issue.line_start as number}` : ''}</div>
    </li>`).join('')}
  </ul>
  ${issues.length > 50 ? `<p style="color: #888; padding: 1rem; text-align: center;">...and ${issues.length - 50} more issues</p>` : ''}`}

  <div class="footer">
    Generated by <a href="https://github.com/braedonsaunders/sloppy">Sloppy</a> &mdash; AI-powered code quality tool
    <br>Generated at ${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC
  </div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function registerReportRoutes(app: FastifyInstance): Promise<void> {
  const db = getDatabase();

  /**
   * GET /api/sessions/:id/report - Generate a shareable report
   * Query params: format=html|json (default: html)
   */
  app.get('/api/sessions/:id/report', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const params = SessionIdParamsSchema.parse(request.params);
      const query = ReportQuerySchema.parse(request.query);

      const session = db.getSession(params.id);
      if (!session) {
        sendError(reply, 'Session not found', 404);
        return;
      }

      const issues = db.listIssuesBySession(params.id);
      const commits = db.listCommitsBySession(params.id);
      const stats = db.getSessionStats(params.id);
      const scoreRecord = db.getLatestScore(params.id);

      let score: { score: number; breakdown: Record<string, unknown> } | null = null;
      if (scoreRecord) {
        try {
          score = {
            score: scoreRecord.score,
            breakdown: JSON.parse(scoreRecord.breakdown) as Record<string, unknown>,
          };
        } catch {
          score = { score: scoreRecord.score, breakdown: {} };
        }
      } else {
        // Compute score on the fly
        const computed = computeScore(issues);
        score = {
          score: computed.score,
          breakdown: computed.breakdown as unknown as Record<string, unknown>,
        };
      }

      if (query.format === 'json') {
        void reply.code(200).send({
          success: true,
          data: {
            session: {
              id: session.id,
              repoPath: session.repo_path,
              branch: session.branch,
              status: session.status,
              startedAt: session.started_at,
              endedAt: session.ended_at,
            },
            score,
            stats,
            issues: issues.map((i) => ({
              type: i.type,
              severity: i.severity,
              filePath: i.file_path,
              lineStart: i.line_start,
              lineEnd: i.line_end,
              description: i.description,
              status: i.status,
            })),
            commits: commits.map((c) => ({
              hash: c.hash,
              message: c.message,
              reverted: Boolean(c.reverted),
            })),
            generatedAt: new Date().toISOString(),
          },
        });
        return;
      }

      // HTML report
      const html = generateHTMLReport({
        session: session as unknown as Record<string, unknown>,
        issues: issues as unknown as Array<Record<string, unknown>>,
        commits: commits as unknown as Array<Record<string, unknown>>,
        score,
        stats: stats as unknown as Record<string, unknown>,
      });

      void reply
        .code(200)
        .type('text/html')
        .send(html);
    } catch (error) {
      if (error instanceof z.ZodError) {
        sendError(reply, `Validation error: ${error.errors.map((e) => e.message).join(', ')}`, 400);
        return;
      }

      app.log.error({ error }, 'Failed to generate report');
      sendError(reply, error instanceof Error ? error.message : 'Failed to generate report', 500);
    }
  });

  app.log.info('[routes] Report routes registered');
}
