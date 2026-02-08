/**
 * Shared utilities used across the codebase.
 * Extracted to eliminate duplication of formatDuration, sleep, and issue parsing.
 */

import { Issue, IssueType, Severity } from './types';

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

/**
 * Format a duration in milliseconds to a human-readable string.
 * Examples: "45s", "5m30s", "2h15m"
 */
export function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem > 0 ? `${m}m${rem}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return remM > 0 ? `${h}h${remM}m` : `${h}h`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Parse a timeout string like "30m", "2h", "90s" to milliseconds.
 * Returns 30 minutes as default for unparseable input.
 */
export function parseTimeout(input: string): number {
  const match = input.match(/^(\d+)(s|m|h)?$/);
  if (!match) return 30 * 60 * 1000;
  const value = parseInt(match[1]);
  const unit = match[2] || 'm';
  switch (unit) {
    case 's': return value * 1000;
    case 'h': return value * 60 * 60 * 1000;
    default:  return value * 60 * 1000;
  }
}

// ---------------------------------------------------------------------------
// Issue parsing helpers
// ---------------------------------------------------------------------------

const VALID_ISSUE_TYPES = new Set<string>([
  'security', 'bugs', 'types', 'lint', 'dead-code', 'stubs', 'duplicates', 'coverage',
]);

export const VALID_SEVERITIES = new Set<string>(['critical', 'high', 'medium', 'low']);

/**
 * Map a raw JSON object to a validated Issue.
 * Returns null if the raw data doesn't have the minimum required shape.
 * Performs runtime type checking to guard against malformed AI model responses.
 */
export function mapRawToIssue(raw: unknown, idPrefix: string, index: number): Issue | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  return {
    id: `${idPrefix}-${Date.now()}-${index}`,
    type: (typeof r.type === 'string' && VALID_ISSUE_TYPES.has(r.type) ? r.type : 'lint') as IssueType,
    severity: (typeof r.severity === 'string' && VALID_SEVERITIES.has(r.severity) ? r.severity : 'medium') as Severity,
    file: typeof r.file === 'string' && r.file ? r.file : 'unknown',
    line: typeof r.line === 'number' ? r.line : undefined,
    description: typeof r.description === 'string' && r.description ? r.description : 'Unknown issue',
    status: 'found' as const,
    evidence: typeof r.evidence === 'string' ? r.evidence : undefined,
    lineContent: typeof r.line_content === 'string' ? r.line_content : undefined,
    source: 'ai' as const,
  };
}

// ---------------------------------------------------------------------------
// GitHub helpers
// ---------------------------------------------------------------------------

/**
 * Parse GITHUB_REPOSITORY env var ("owner/repo") into components.
 * Returns null if missing or malformed.
 */
export function parseGitHubRepo(): { owner: string; repo: string } | null {
  const full = process.env.GITHUB_REPOSITORY || '';
  const idx = full.indexOf('/');
  if (idx <= 0 || idx >= full.length - 1) return null;
  return { owner: full.slice(0, idx), repo: full.slice(idx + 1) };
}
