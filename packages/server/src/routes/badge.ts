/**
 * Badge routes - Generate SVG score badges for embedding in READMEs
 * Viral sharing mechanic: people showcase their Sloppy Score
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getDatabase } from '../db/database.js';

const SessionIdParamsSchema = z.object({
  id: z.string().min(1),
});

const StaticBadgeParamsSchema = z.object({
  score: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().min(0).max(100)),
});

const BadgeQuerySchema = z.object({
  style: z.enum(['flat', 'flat-square']).optional().default('flat'),
  label: z.string().optional().default('sloppy score'),
});

function getScoreColor(score: number): string {
  if (score >= 90) return '#4c1';       // bright green
  if (score >= 80) return '#97ca00';    // green
  if (score >= 70) return '#a4a61d';    // yellow-green
  if (score >= 60) return '#dfb317';    // yellow
  if (score >= 50) return '#fe7d37';    // orange
  if (score >= 40) return '#e05d44';    // red
  return '#e05d44';                      // red
}

function getScoreLabel(score: number): string {
  if (score >= 90) return 'excellent';
  if (score >= 80) return 'great';
  if (score >= 70) return 'good';
  if (score >= 60) return 'fair';
  if (score >= 50) return 'needs work';
  return 'poor';
}

function generateBadgeSVG(label: string, score: number, style: 'flat' | 'flat-square'): string {
  const scoreText = `${score}/100`;
  const color = getScoreColor(score);
  const labelWidth = label.length * 6.5 + 12;
  const valueWidth = scoreText.length * 6.5 + 12;
  const totalWidth = labelWidth + valueWidth;
  const radius = style === 'flat' ? '3' : '0';

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${totalWidth}" height="20" role="img" aria-label="${label}: ${scoreText}">
  <title>${label}: ${scoreText} (${getScoreLabel(score)})</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r">
    <rect width="${totalWidth}" height="20" rx="${radius}" fill="#fff"/>
  </clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelWidth}" height="20" fill="#555"/>
    <rect x="${labelWidth}" width="${valueWidth}" height="20" fill="${color}"/>
    <rect width="${totalWidth}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="110">
    <text aria-hidden="true" x="${(labelWidth / 2) * 10}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${(labelWidth - 10) * 10}">${escapeXml(label)}</text>
    <text x="${(labelWidth / 2) * 10}" y="140" transform="scale(.1)" fill="#fff" textLength="${(labelWidth - 10) * 10}">${escapeXml(label)}</text>
    <text aria-hidden="true" x="${(labelWidth + valueWidth / 2) * 10}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${(valueWidth - 10) * 10}">${scoreText}</text>
    <text x="${(labelWidth + valueWidth / 2) * 10}" y="140" transform="scale(.1)" fill="#fff" textLength="${(valueWidth - 10) * 10}">${scoreText}</text>
  </g>
</svg>`;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function registerBadgeRoutes(app: FastifyInstance): Promise<void> {
  const db = getDatabase();

  /**
   * GET /api/sessions/:id/badge - Generate SVG badge for a session's score
   *
   * Usage in README:
   *   ![Sloppy Score](http://localhost:7749/api/sessions/SESSION_ID/badge)
   */
  app.get('/api/sessions/:id/badge', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const params = SessionIdParamsSchema.parse(request.params);
      const query = BadgeQuerySchema.parse(request.query);

      const session = db.getSession(params.id);
      if (!session) {
        void reply.code(404).type('text/plain').send('Session not found');
        return;
      }

      const scoreRecord = db.getLatestScore(params.id);
      const score = scoreRecord?.score ?? 0;

      const svg = generateBadgeSVG(query.label, score, query.style);

      void reply
        .code(200)
        .type('image/svg+xml')
        .header('Cache-Control', 'no-cache, no-store, must-revalidate')
        .header('Pragma', 'no-cache')
        .header('Expires', '0')
        .send(svg);
    } catch (error) {
      app.log.error({ error }, 'Failed to generate badge');
      void reply.code(500).type('text/plain').send('Failed to generate badge');
    }
  });

  /**
   * GET /api/badge/:score - Generate a static SVG badge for any score
   *
   * Usage in README (with shields.io-style URL):
   *   ![Sloppy Score](http://localhost:7749/api/badge/87)
   */
  app.get('/api/badge/:score', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const params = StaticBadgeParamsSchema.parse(request.params);
      const query = BadgeQuerySchema.parse(request.query);

      const svg = generateBadgeSVG(query.label, params.score, query.style);

      void reply
        .code(200)
        .type('image/svg+xml')
        .header('Cache-Control', 'public, max-age=3600')
        .send(svg);
    } catch (error) {
      app.log.error({ error }, 'Failed to generate badge');
      void reply.code(400).type('text/plain').send('Invalid score (0-100)');
    }
  });

  app.log.info('[routes] Badge routes registered');
}
