/**
 * Session Types and Interfaces
 *
 * Defines the structure for Sloppy cleaning sessions.
 * A session represents a single run of the code quality improvement process.
 */

import type { IssueType } from './issue.js';
import type { ProviderConfig } from './provider.js';

/**
 * Status of a cleaning session.
 */
export enum SessionStatus {
  /** Session is being set up and configured */
  INITIALIZING = 'INITIALIZING',

  /** Analyzing codebase for issues */
  ANALYZING = 'ANALYZING',

  /** Actively fixing issues */
  CLEANING = 'CLEANING',

  /** Temporarily paused by user */
  PAUSED = 'PAUSED',

  /** All issues addressed or time limit reached */
  COMPLETED = 'COMPLETED',

  /** Session terminated due to error */
  FAILED = 'FAILED',
}

/**
 * Strictness level for code quality enforcement.
 * Determines how aggressively issues are detected and fixed.
 */
export type StrictnessLevel = 'low' | 'medium' | 'high';

/**
 * Configuration for a cleaning session.
 */
export interface SessionConfig {
  /**
   * How strict to be when detecting and fixing issues.
   * - low: Only obvious issues, conservative fixes
   * - medium: Standard code quality enforcement
   * - high: Aggressive detection, may flag false positives
   * @default 'medium'
   */
  strictness: StrictnessLevel;

  /**
   * Which issue types to detect and address.
   * If undefined, all types are enabled.
   */
  issueTypes?: IssueType[];

  /**
   * Glob patterns for files/directories to ignore.
   * Applied in addition to .gitignore patterns.
   * Example: ["node_modules", "dist", "*.min.js"]
   */
  ignorePatterns: string[];

  /**
   * Command to run tests.
   * Used to verify fixes don't break existing functionality.
   * Example: "npm test" or "pnpm test -- --run"
   */
  testCommand?: string;

  /**
   * Command to run linter.
   * Used to detect lint issues and verify fixes.
   * Example: "npm run lint" or "eslint src/"
   */
  lintCommand?: string;

  /**
   * Command to build the project.
   * Used to verify type errors are fixed and code compiles.
   * Example: "npm run build" or "tsc --noEmit"
   */
  buildCommand?: string;

  /**
   * Maximum number of fix attempts per issue before skipping.
   * @default 3
   */
  maxAttemptsPerIssue?: number;

  /**
   * Whether to automatically commit each successful fix.
   * @default true
   */
  autoCommit?: boolean;

  /**
   * Commit message prefix for auto-commits.
   * @default 'fix(sloppy):'
   */
  commitPrefix?: string;

  /**
   * Whether to run in dry-run mode (no actual changes).
   * @default false
   */
  dryRun?: boolean;

  /**
   * Maximum number of concurrent issue fixes.
   * @default 1
   */
  concurrency?: number;

  /**
   * Custom prompt additions for the AI provider.
   */
  customPrompt?: string;
}

/**
 * Represents a single cleaning session.
 */
export interface Session {
  /**
   * Unique identifier for the session.
   * Format: UUID v4
   */
  id: string;

  /**
   * Absolute path to the repository being cleaned.
   */
  repoPath: string;

  /**
   * Git branch being worked on.
   * Created specifically for this cleaning session.
   */
  branch: string;

  /**
   * Current status of the session.
   */
  status: SessionStatus;

  /**
   * Maximum time allowed for the session in minutes.
   * Session will pause/complete when time limit is reached.
   */
  maxTimeMinutes: number;

  /**
   * ID of the AI provider configuration being used.
   */
  providerId: string;

  /**
   * Timestamp when the session started.
   */
  startedAt: Date;

  /**
   * Timestamp when the session ended.
   * Undefined if session is still active.
   */
  endedAt?: Date;

  /**
   * Configuration for this session.
   */
  config: SessionConfig;

  /**
   * Provider configuration used for this session.
   */
  providerConfig?: ProviderConfig;

  /**
   * Original branch that was checked out before session started.
   * Used for restoring state if session is cancelled.
   */
  originalBranch?: string;

  /**
   * Error message if session failed.
   */
  error?: string;

  /**
   * User-provided description or notes for this session.
   */
  description?: string;

  /**
   * Tags for organizing and filtering sessions.
   */
  tags?: string[];
}

/**
 * Summary of a session's progress and results.
 */
export interface SessionSummary {
  /** Session ID */
  sessionId: string;

  /** Total issues found */
  totalIssues: number;

  /** Issues successfully resolved */
  resolvedIssues: number;

  /** Issues that failed to fix */
  failedIssues: number;

  /** Issues still pending */
  pendingIssues: number;

  /** Total commits made */
  totalCommits: number;

  /** Commits that were reverted */
  revertedCommits: number;

  /** Time spent in seconds */
  durationSeconds: number;

  /** Test pass rate before session */
  testPassRateBefore?: number;

  /** Test pass rate after session */
  testPassRateAfter?: number;

  /** Lint error count before session */
  lintErrorsBefore?: number;

  /** Lint error count after session */
  lintErrorsAfter?: number;

  /** Type error count before session */
  typeErrorsBefore?: number;

  /** Type error count after session */
  typeErrorsAfter?: number;
}

/**
 * Options for creating a new session.
 */
export interface CreateSessionOptions {
  /** Path to the repository */
  repoPath: string;

  /** Maximum session duration in minutes */
  maxTimeMinutes: number;

  /** Provider configuration ID to use */
  providerId: string;

  /** Session configuration */
  config: Partial<SessionConfig>;

  /** Optional description */
  description?: string;

  /** Optional tags */
  tags?: string[];
}

/**
 * Default session configuration values.
 */
export const DEFAULT_SESSION_CONFIG: SessionConfig = {
  strictness: 'medium',
  ignorePatterns: [
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/.git/**',
    '**/coverage/**',
    '**/*.min.js',
    '**/*.min.css',
    '**/vendor/**',
  ],
  maxAttemptsPerIssue: 3,
  autoCommit: true,
  commitPrefix: 'fix(sloppy):',
  dryRun: false,
  concurrency: 1,
};

/**
 * Create a complete session config by merging with defaults.
 *
 * @param partial - Partial configuration to merge
 * @returns Complete session configuration
 */
export function mergeSessionConfig(
  partial: Partial<SessionConfig>
): SessionConfig {
  return {
    ...DEFAULT_SESSION_CONFIG,
    ...partial,
    ignorePatterns: [
      ...DEFAULT_SESSION_CONFIG.ignorePatterns,
      ...(partial.ignorePatterns ?? []),
    ],
  };
}
