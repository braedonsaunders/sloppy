/**
 * Issue Types and Interfaces
 *
 * Defines the structure for code quality issues detected by Sloppy.
 * Issues represent problems in the codebase that need to be addressed.
 */

/**
 * Types of issues that Sloppy can detect and address.
 * Each type represents a different category of code quality problem.
 */
export enum IssueType {
  /** Placeholder or incomplete implementation (TODO, FIXME, stub functions) */
  STUB = 'STUB',

  /** Duplicated code that should be refactored */
  DUPLICATE = 'DUPLICATE',

  /** Logical bug or runtime error */
  BUG = 'BUG',

  /** TypeScript type error or type safety issue */
  TYPE_ERROR = 'TYPE_ERROR',

  /** ESLint or other linter violation */
  LINT_ERROR = 'LINT_ERROR',

  /** Missing test coverage for critical code paths */
  MISSING_TEST = 'MISSING_TEST',

  /** Unreachable or unused code that should be removed */
  DEAD_CODE = 'DEAD_CODE',

  /** Security vulnerability or unsafe code pattern */
  SECURITY = 'SECURITY',
}

/**
 * Severity levels for issues, determining priority of resolution.
 * Higher severity issues should be addressed first.
 */
export enum IssueSeverity {
  /** Blocks deployment or causes data loss/security breach */
  CRITICAL = 'CRITICAL',

  /** Major functionality broken, needs immediate attention */
  HIGH = 'HIGH',

  /** Significant issue but workaround exists */
  MEDIUM = 'MEDIUM',

  /** Minor issue, cosmetic or best practice violation */
  LOW = 'LOW',
}

/**
 * Status of an issue in the resolution workflow.
 */
export type IssueStatus = 'pending' | 'in_progress' | 'resolved' | 'failed';

/**
 * Represents a single code quality issue detected in the codebase.
 */
export interface Issue {
  /**
   * Unique identifier for the issue.
   * Format: UUID v4
   */
  id: string;

  /**
   * Category of the issue.
   */
  type: IssueType;

  /**
   * How severe/urgent this issue is.
   */
  severity: IssueSeverity;

  /**
   * Absolute path to the file containing the issue.
   */
  filePath: string;

  /**
   * Starting line number (1-indexed) where the issue begins.
   */
  lineStart: number;

  /**
   * Ending line number (1-indexed) where the issue ends.
   * May be the same as lineStart for single-line issues.
   */
  lineEnd: number;

  /**
   * Human-readable description of what the issue is and why it matters.
   */
  description: string;

  /**
   * Code snippet showing the problematic code.
   * Includes surrounding context for better understanding.
   */
  context: string;

  /**
   * Current status in the resolution workflow.
   */
  status: IssueStatus;

  /**
   * Timestamp when the issue was first detected.
   */
  createdAt: Date;

  /**
   * Timestamp when the issue was successfully resolved.
   * Undefined if not yet resolved.
   */
  resolvedAt?: Date;

  /**
   * Number of fix attempts made for this issue.
   * Used to determine if we should skip after repeated failures.
   */
  attempts: number;

  /**
   * Optional suggested fix from the AI provider.
   */
  suggestedFix?: string;

  /**
   * Optional error message if the last fix attempt failed.
   */
  lastError?: string;

  /**
   * Optional tags for categorization and filtering.
   */
  tags?: string[];
}

/**
 * Summary statistics for issues in a session.
 */
export interface IssueSummary {
  /** Total number of issues detected */
  total: number;

  /** Count by issue type */
  byType: Record<IssueType, number>;

  /** Count by severity */
  bySeverity: Record<IssueSeverity, number>;

  /** Count by status */
  byStatus: Record<IssueStatus, number>;
}

/**
 * Filter options for querying issues.
 */
export interface IssueFilter {
  /** Filter by issue types */
  types?: IssueType[];

  /** Filter by severities */
  severities?: IssueSeverity[];

  /** Filter by statuses */
  statuses?: IssueStatus[];

  /** Filter by file path pattern (glob) */
  filePattern?: string;

  /** Filter issues created after this date */
  createdAfter?: Date;

  /** Filter issues created before this date */
  createdBefore?: Date;

  /** Filter by tags */
  tags?: string[];
}

/**
 * Options for sorting issues.
 */
export interface IssueSortOptions {
  /** Field to sort by */
  field: 'severity' | 'type' | 'createdAt' | 'filePath' | 'attempts';

  /** Sort direction */
  direction: 'asc' | 'desc';
}

/**
 * Priority weights for different issue types.
 * Used to determine fix order when severity is equal.
 */
export const ISSUE_TYPE_PRIORITY: Record<IssueType, number> = {
  [IssueType.SECURITY]: 100,
  [IssueType.BUG]: 90,
  [IssueType.TYPE_ERROR]: 80,
  [IssueType.LINT_ERROR]: 70,
  [IssueType.STUB]: 60,
  [IssueType.MISSING_TEST]: 50,
  [IssueType.DUPLICATE]: 40,
  [IssueType.DEAD_CODE]: 30,
};

/**
 * Priority weights for different severity levels.
 */
export const SEVERITY_PRIORITY: Record<IssueSeverity, number> = {
  [IssueSeverity.CRITICAL]: 100,
  [IssueSeverity.HIGH]: 75,
  [IssueSeverity.MEDIUM]: 50,
  [IssueSeverity.LOW]: 25,
};

/**
 * Calculate the overall priority score for an issue.
 * Higher scores should be addressed first.
 *
 * @param issue - The issue to calculate priority for
 * @returns Priority score (0-200)
 */
export function calculateIssuePriority(issue: Issue): number {
  return SEVERITY_PRIORITY[issue.severity] + ISSUE_TYPE_PRIORITY[issue.type];
}
