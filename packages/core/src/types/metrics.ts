/**
 * Metrics Types and Interfaces
 *
 * Defines the structure for tracking code quality metrics over time.
 * Metrics are collected at various points during a session to measure progress.
 */

/**
 * Represents a snapshot of code quality metrics at a point in time.
 */
export interface Metrics {
  /**
   * Unique identifier for this metrics record.
   * Format: UUID v4
   */
  id: string;

  /**
   * ID of the session these metrics belong to.
   */
  sessionId: string;

  /**
   * Timestamp when these metrics were collected.
   */
  timestamp: Date;

  /**
   * Total number of issues detected.
   */
  totalIssues: number;

  /**
   * Number of issues that have been resolved.
   */
  resolvedIssues: number;

  /**
   * Total number of test cases.
   */
  testCount: number;

  /**
   * Number of tests currently passing.
   */
  testsPassing: number;

  /**
   * Number of lint errors detected.
   */
  lintErrors: number;

  /**
   * Number of TypeScript type errors.
   */
  typeErrors: number;

  /**
   * Code coverage percentage (0-100).
   * Undefined if coverage is not configured.
   */
  coveragePercent?: number;

  /**
   * Number of tests currently failing.
   */
  testsFailing?: number;

  /**
   * Number of tests skipped.
   */
  testsSkipped?: number;

  /**
   * Build status at this point.
   */
  buildStatus?: 'success' | 'failure' | 'unknown';

  /**
   * Build duration in milliseconds.
   */
  buildDurationMs?: number;

  /**
   * Total lines of code in the project.
   */
  totalLinesOfCode?: number;

  /**
   * Number of files in the project.
   */
  totalFiles?: number;

  /**
   * Memory usage in bytes (for monitoring long sessions).
   */
  memoryUsageBytes?: number;

  /**
   * Custom metrics from plugins or extensions.
   */
  customMetrics?: Record<string, number | string | boolean>;
}

/**
 * Metrics collection configuration.
 */
export interface MetricsConfig {
  /**
   * How often to collect metrics during a session (in seconds).
   * @default 60
   */
  collectionIntervalSeconds: number;

  /**
   * Whether to collect test metrics.
   * @default true
   */
  collectTestMetrics: boolean;

  /**
   * Whether to collect lint metrics.
   * @default true
   */
  collectLintMetrics: boolean;

  /**
   * Whether to collect coverage metrics.
   * @default true
   */
  collectCoverageMetrics: boolean;

  /**
   * Whether to collect build metrics.
   * @default true
   */
  collectBuildMetrics: boolean;

  /**
   * Whether to store metrics history.
   * @default true
   */
  storeHistory: boolean;

  /**
   * Maximum number of metrics records to keep per session.
   * @default 1000
   */
  maxRecordsPerSession: number;
}

/**
 * Default metrics configuration.
 */
export const DEFAULT_METRICS_CONFIG: MetricsConfig = {
  collectionIntervalSeconds: 60,
  collectTestMetrics: true,
  collectLintMetrics: true,
  collectCoverageMetrics: true,
  collectBuildMetrics: true,
  storeHistory: true,
  maxRecordsPerSession: 1000,
};

/**
 * Aggregated metrics summary for a session.
 */
export interface MetricsSummary {
  /**
   * Session ID.
   */
  sessionId: string;

  /**
   * First metrics snapshot (baseline).
   */
  baseline: Metrics;

  /**
   * Latest metrics snapshot.
   */
  current: Metrics;

  /**
   * Changes from baseline to current.
   */
  delta: MetricsDelta;

  /**
   * Trend analysis.
   */
  trends: MetricsTrends;
}

/**
 * Change in metrics from one point to another.
 */
export interface MetricsDelta {
  /**
   * Change in total issues.
   */
  totalIssuesDelta: number;

  /**
   * Change in resolved issues.
   */
  resolvedIssuesDelta: number;

  /**
   * Change in passing tests.
   */
  testsPassingDelta: number;

  /**
   * Change in lint errors.
   */
  lintErrorsDelta: number;

  /**
   * Change in type errors.
   */
  typeErrorsDelta: number;

  /**
   * Change in coverage percentage.
   */
  coveragePercentDelta?: number;

  /**
   * Percentage improvement in issue resolution.
   */
  issueResolutionRate: number;

  /**
   * Percentage improvement in test pass rate.
   */
  testPassRateImprovement: number;
}

/**
 * Trend analysis for metrics over time.
 */
export interface MetricsTrends {
  /**
   * Whether issues are trending down (improving).
   */
  issuesTrending: 'improving' | 'stable' | 'worsening';

  /**
   * Whether tests are trending up (improving).
   */
  testsTrending: 'improving' | 'stable' | 'worsening';

  /**
   * Whether lint errors are trending down (improving).
   */
  lintTrending: 'improving' | 'stable' | 'worsening';

  /**
   * Whether type errors are trending down (improving).
   */
  typesTrending: 'improving' | 'stable' | 'worsening';

  /**
   * Overall health score (0-100).
   */
  healthScore: number;
}

/**
 * Calculate the delta between two metrics snapshots.
 *
 * @param baseline - Starting metrics
 * @param current - Ending metrics
 * @returns Metrics delta
 */
export function calculateMetricsDelta(
  baseline: Metrics,
  current: Metrics
): MetricsDelta {
  const totalIssuesDelta = current.totalIssues - baseline.totalIssues;
  const resolvedIssuesDelta = current.resolvedIssues - baseline.resolvedIssues;
  const testsPassingDelta = current.testsPassing - baseline.testsPassing;
  const lintErrorsDelta = current.lintErrors - baseline.lintErrors;
  const typeErrorsDelta = current.typeErrors - baseline.typeErrors;

  // Calculate resolution rate
  const issueResolutionRate =
    baseline.totalIssues > 0
      ? (resolvedIssuesDelta / baseline.totalIssues) * 100
      : 0;

  // Calculate test improvement
  const baselinePassRate =
    baseline.testCount > 0
      ? (baseline.testsPassing / baseline.testCount) * 100
      : 0;
  const currentPassRate =
    current.testCount > 0
      ? (current.testsPassing / current.testCount) * 100
      : 0;
  const testPassRateImprovement = currentPassRate - baselinePassRate;

  const result: MetricsDelta = {
    totalIssuesDelta,
    resolvedIssuesDelta,
    testsPassingDelta,
    lintErrorsDelta,
    typeErrorsDelta,
    issueResolutionRate,
    testPassRateImprovement,
  };

  if (
    baseline.coveragePercent !== undefined &&
    current.coveragePercent !== undefined
  ) {
    result.coveragePercentDelta =
      current.coveragePercent - baseline.coveragePercent;
  }

  return result;
}

/**
 * Analyze trends from a series of metrics snapshots.
 *
 * @param metrics - Array of metrics snapshots (oldest first)
 * @returns Trend analysis
 */
export function analyzeMetricsTrends(metrics: Metrics[]): MetricsTrends {
  if (metrics.length < 2) {
    return {
      issuesTrending: 'stable',
      testsTrending: 'stable',
      lintTrending: 'stable',
      typesTrending: 'stable',
      healthScore: 50,
    };
  }

  // Get recent trend (last 5 snapshots or all if fewer)
  const recentMetrics = metrics.slice(-5);
  const first = recentMetrics[0];
  const last = recentMetrics[recentMetrics.length - 1];

  if (!first || !last) {
    return {
      issuesTrending: 'stable',
      testsTrending: 'stable',
      lintTrending: 'stable',
      typesTrending: 'stable',
      healthScore: 50,
    };
  }

  const determineTrend = (
    startValue: number,
    endValue: number,
    lowerIsBetter: boolean
  ): 'improving' | 'stable' | 'worsening' => {
    const threshold = 0.05; // 5% change threshold
    const change = (endValue - startValue) / (startValue || 1);

    if (Math.abs(change) < threshold) return 'stable';

    if (lowerIsBetter) {
      return change < 0 ? 'improving' : 'worsening';
    } else {
      return change > 0 ? 'improving' : 'worsening';
    }
  };

  const issuesTrending = determineTrend(
    first.totalIssues - first.resolvedIssues,
    last.totalIssues - last.resolvedIssues,
    true
  );

  const testsTrending = determineTrend(
    first.testsPassing,
    last.testsPassing,
    false
  );

  const lintTrending = determineTrend(first.lintErrors, last.lintErrors, true);

  const typesTrending = determineTrend(
    first.typeErrors,
    last.typeErrors,
    true
  );

  // Calculate health score (0-100)
  const testPassRate =
    last.testCount > 0 ? (last.testsPassing / last.testCount) * 100 : 100;

  const unresolvedIssuesPenalty = Math.min(
    (last.totalIssues - last.resolvedIssues) * 2,
    40
  );

  const lintPenalty = Math.min(last.lintErrors, 20);
  const typePenalty = Math.min(last.typeErrors * 2, 20);

  const healthScore = Math.max(
    0,
    Math.min(
      100,
      testPassRate - unresolvedIssuesPenalty - lintPenalty - typePenalty
    )
  );

  return {
    issuesTrending,
    testsTrending,
    lintTrending,
    typesTrending,
    healthScore: Math.round(healthScore),
  };
}

/**
 * Format metrics for display.
 *
 * @param metrics - Metrics to format
 * @returns Formatted string representation
 */
export function formatMetrics(metrics: Metrics): string {
  const testPassRate =
    metrics.testCount > 0
      ? ((metrics.testsPassing / metrics.testCount) * 100).toFixed(1)
      : 'N/A';

  return [
    `Issues: ${metrics.resolvedIssues}/${metrics.totalIssues} resolved`,
    `Tests: ${metrics.testsPassing}/${metrics.testCount} passing (${testPassRate}%)`,
    `Lint Errors: ${metrics.lintErrors}`,
    `Type Errors: ${metrics.typeErrors}`,
    metrics.coveragePercent !== undefined
      ? `Coverage: ${metrics.coveragePercent.toFixed(1)}%`
      : null,
  ]
    .filter(Boolean)
    .join(' | ');
}
