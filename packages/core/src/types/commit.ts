/**
 * Commit Types and Interfaces
 *
 * Defines the structure for tracking git commits made during cleaning sessions.
 * Each fix may result in one or more commits that can be tracked and reverted.
 */

/**
 * Represents a git commit made during a cleaning session.
 */
export interface Commit {
  /**
   * Unique identifier for this commit record.
   * Format: UUID v4
   */
  id: string;

  /**
   * ID of the session this commit belongs to.
   */
  sessionId: string;

  /**
   * ID of the issue this commit addresses.
   * May be undefined for commits that address multiple issues.
   */
  issueId?: string;

  /**
   * Git commit hash (SHA-1).
   */
  hash: string;

  /**
   * Commit message.
   */
  message: string;

  /**
   * Full diff content of the commit.
   * Stored for potential revert operations.
   */
  diffContent: string;

  /**
   * Timestamp when the commit was created.
   */
  createdAt: Date;

  /**
   * Whether this commit has been reverted.
   */
  reverted: boolean;

  /**
   * Timestamp when the commit was reverted.
   * Undefined if not reverted.
   */
  revertedAt?: Date;

  /**
   * Hash of the revert commit.
   * Undefined if not reverted.
   */
  revertHash?: string;

  /**
   * Reason for reverting the commit.
   * Undefined if not reverted.
   */
  revertReason?: string;

  /**
   * Files changed in this commit.
   */
  filesChanged: CommitFileChange[];

  /**
   * Total lines added in this commit.
   */
  linesAdded: number;

  /**
   * Total lines removed in this commit.
   */
  linesRemoved: number;

  /**
   * Author name from git config.
   */
  author?: string;

  /**
   * Author email from git config.
   */
  authorEmail?: string;
}

/**
 * Represents a single file change within a commit.
 */
export interface CommitFileChange {
  /**
   * Path to the file (relative to repo root).
   */
  filePath: string;

  /**
   * Type of change made to the file.
   */
  changeType: 'added' | 'modified' | 'deleted' | 'renamed';

  /**
   * Original file path (for renames).
   */
  oldPath?: string;

  /**
   * Lines added in this file.
   */
  linesAdded: number;

  /**
   * Lines removed in this file.
   */
  linesRemoved: number;
}

/**
 * Options for creating a commit.
 */
export interface CreateCommitOptions {
  /**
   * Session ID this commit belongs to.
   */
  sessionId: string;

  /**
   * Issue ID this commit addresses.
   */
  issueId?: string;

  /**
   * Commit message.
   */
  message: string;

  /**
   * Files to stage for commit.
   * If undefined, all changes are staged.
   */
  files?: string[];

  /**
   * Whether to amend the previous commit.
   * @default false
   */
  amend?: boolean;
}

/**
 * Result of a commit operation.
 */
export interface CommitResult {
  /**
   * Whether the commit was successful.
   */
  success: boolean;

  /**
   * The commit record if successful.
   */
  commit?: Commit;

  /**
   * Error message if commit failed.
   */
  error?: string;

  /**
   * Git output for debugging.
   */
  gitOutput?: string;
}

/**
 * Options for reverting a commit.
 */
export interface RevertCommitOptions {
  /**
   * ID of the commit to revert.
   */
  commitId: string;

  /**
   * Reason for reverting.
   */
  reason: string;

  /**
   * Whether to create a revert commit (true) or hard reset (false).
   * @default true
   */
  createRevertCommit?: boolean;
}

/**
 * Result of a revert operation.
 */
export interface RevertResult {
  /**
   * Whether the revert was successful.
   */
  success: boolean;

  /**
   * Hash of the revert commit if created.
   */
  revertHash?: string;

  /**
   * Error message if revert failed.
   */
  error?: string;

  /**
   * Git output for debugging.
   */
  gitOutput?: string;
}

/**
 * Filter options for querying commits.
 */
export interface CommitFilter {
  /**
   * Filter by session ID.
   */
  sessionId?: string;

  /**
   * Filter by issue ID.
   */
  issueId?: string;

  /**
   * Filter by reverted status.
   */
  reverted?: boolean;

  /**
   * Filter commits created after this date.
   */
  createdAfter?: Date;

  /**
   * Filter commits created before this date.
   */
  createdBefore?: Date;

  /**
   * Filter by file path pattern.
   */
  filePattern?: string;
}

/**
 * Summary statistics for commits in a session.
 */
export interface CommitSummary {
  /**
   * Total number of commits.
   */
  total: number;

  /**
   * Number of reverted commits.
   */
  reverted: number;

  /**
   * Total lines added across all commits.
   */
  totalLinesAdded: number;

  /**
   * Total lines removed across all commits.
   */
  totalLinesRemoved: number;

  /**
   * Total files changed across all commits.
   */
  totalFilesChanged: number;
}

/**
 * Generate a standard commit message for a fix.
 *
 * @param prefix - Commit message prefix
 * @param issueType - Type of issue being fixed
 * @param description - Brief description of the fix
 * @returns Formatted commit message
 */
export function formatCommitMessage(
  prefix: string,
  issueType: string,
  description: string
): string {
  // Ensure description fits within typical commit message guidelines
  const maxDescLength = 72 - prefix.length - issueType.length - 4;
  const truncatedDesc =
    description.length > maxDescLength
      ? `${description.slice(0, maxDescLength - 3)}...`
      : description;

  return `${prefix} [${issueType}] ${truncatedDesc}`;
}

/**
 * Parse a git diff output into file changes.
 *
 * @param diffOutput - Raw git diff output
 * @returns Array of file changes
 */
export function parseDiffToFileChanges(diffOutput: string): CommitFileChange[] {
  const changes: CommitFileChange[] = [];
  const fileRegex = /^diff --git a\/(.+) b\/(.+)$/gm;
  const statsRegex = /^(\d+) insertions?\(\+\), (\d+) deletions?\(-\)$/gm;

  let match: RegExpExecArray | null;
  while ((match = fileRegex.exec(diffOutput)) !== null) {
    const oldPath = match[1];
    const newPath = match[2];

    let changeType: CommitFileChange['changeType'] = 'modified';
    if (oldPath !== newPath) {
      changeType = 'renamed';
    }

    // This is a simplified parser - real implementation would need
    // to parse the actual diff hunks to count lines
    const fileChange: CommitFileChange = {
      filePath: newPath ?? oldPath ?? '',
      changeType,
      linesAdded: 0,
      linesRemoved: 0,
    };

    if (changeType === 'renamed' && oldPath) {
      fileChange.oldPath = oldPath;
    }

    changes.push(fileChange);
  }

  return changes;
}
