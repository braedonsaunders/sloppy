/**
 * Scoring service - Computes a 0-100 Sloppy Score for a session
 * Weighted scoring based on issue categories and severity
 */

import type { SloppyDatabase, Issue, Score } from '../db/database.js';

export interface ScoreBreakdown {
  security: number;        // 0-100 (weight: 25%)
  bugs: number;            // 0-100 (weight: 20%)
  codeQuality: number;     // 0-100 (weight: 20%) - lint, style, dead code
  maintainability: number; // 0-100 (weight: 15%) - duplicates, complexity
  reliability: number;     // 0-100 (weight: 10%) - test coverage, stubs
  improvement: number;     // 0-100 (weight: 10%) - % issues fixed
}

export interface ScoreResult {
  score: number;
  breakdown: ScoreBreakdown;
  issuesBefore: number;
  issuesAfter: number;
}

// Category weights (must sum to 1.0)
const CATEGORY_WEIGHTS: Record<keyof ScoreBreakdown, number> = {
  security: 0.25,
  bugs: 0.20,
  codeQuality: 0.20,
  maintainability: 0.15,
  reliability: 0.10,
  improvement: 0.10,
};

// Severity penalty per issue
const SEVERITY_PENALTIES: Record<string, number> = {
  error: 5,
  warning: 3,
  info: 1,
  hint: 0.5,
};

// Map issue types to score categories
function getCategory(issue: Issue): keyof ScoreBreakdown | null {
  switch (issue.type) {
    case 'security':
      return 'security';
    case 'type':
      return 'bugs';
    case 'lint':
    case 'style':
      return 'codeQuality';
    case 'performance':
      return 'maintainability';
    case 'test':
      return 'reliability';
    default:
      return 'codeQuality';
  }
}

/**
 * Compute a category score (0-100) from issue penalties
 */
function computeCategoryScore(issues: Issue[]): number {
  let penalty = 0;
  for (const issue of issues) {
    const severityPenalty = SEVERITY_PENALTIES[issue.severity] ?? 1;
    // Only count unresolved issues for the penalty
    if (issue.status !== 'fixed' && issue.status !== 'approved') {
      penalty += severityPenalty;
    }
  }
  // Clamp: start at 100, subtract penalties, floor at 0
  return Math.max(0, Math.min(100, 100 - penalty));
}

/**
 * Compute the improvement score based on fixed ratio
 */
function computeImprovementScore(totalIssues: number, fixedIssues: number): number {
  if (totalIssues === 0) return 100; // No issues = perfect improvement
  const ratio = fixedIssues / totalIssues;
  return Math.round(ratio * 100);
}

/**
 * Compute the overall Sloppy Score for a session
 */
export function computeScore(issues: Issue[]): ScoreResult {
  // Group issues by category
  const categoryIssues: Record<keyof ScoreBreakdown, Issue[]> = {
    security: [],
    bugs: [],
    codeQuality: [],
    maintainability: [],
    reliability: [],
    improvement: [],
  };

  for (const issue of issues) {
    const category = getCategory(issue);
    if (category && category !== 'improvement') {
      categoryIssues[category].push(issue);
    }
  }

  // Count total and fixed issues
  const totalIssues = issues.length;
  const fixedIssues = issues.filter(
    (i) => i.status === 'fixed' || i.status === 'approved'
  ).length;
  const unresolvedIssues = totalIssues - fixedIssues;

  // Compute category scores
  const breakdown: ScoreBreakdown = {
    security: computeCategoryScore(categoryIssues.security),
    bugs: computeCategoryScore(categoryIssues.bugs),
    codeQuality: computeCategoryScore(categoryIssues.codeQuality),
    maintainability: computeCategoryScore(categoryIssues.maintainability),
    reliability: computeCategoryScore(categoryIssues.reliability),
    improvement: computeImprovementScore(totalIssues, fixedIssues),
  };

  // Compute weighted overall score
  let overallScore = 0;
  for (const [category, weight] of Object.entries(CATEGORY_WEIGHTS)) {
    overallScore += breakdown[category as keyof ScoreBreakdown] * weight;
  }

  // Clamp to 0-100 integer
  const score = Math.max(0, Math.min(100, Math.round(overallScore)));

  return {
    score,
    breakdown,
    issuesBefore: totalIssues,
    issuesAfter: unresolvedIssues,
  };
}

/**
 * Compute and persist a Sloppy Score for a session
 */
export function computeAndSaveScore(
  db: SloppyDatabase,
  sessionId: string,
): Score {
  // Get all issues for this session
  const issues = db.listIssuesBySession(sessionId);

  // Compute the score
  const result = computeScore(issues);

  // Save to database
  const score = db.createScore({
    session_id: sessionId,
    score: result.score,
    breakdown: result.breakdown as unknown as Record<string, number>,
    issues_before: result.issuesBefore,
    issues_after: result.issuesAfter,
  });

  return score;
}
