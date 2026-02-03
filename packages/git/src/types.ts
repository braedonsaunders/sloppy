/**
 * Git-specific type definitions for @sloppy/git
 */

/**
 * Information about a single commit
 */
export interface CommitInfo {
  /** Full commit hash (40 characters) */
  hash: string;
  /** Abbreviated commit hash */
  shortHash: string;
  /** Commit message (first line) */
  message: string;
  /** Full commit message including body */
  fullMessage: string;
  /** Author name */
  authorName: string;
  /** Author email */
  authorEmail: string;
  /** Commit timestamp */
  date: Date;
  /** Parent commit hashes */
  parents: string[];
}

/**
 * Status of a single file in the working directory
 */
export interface FileStatus {
  /** File path relative to repository root */
  path: string;
  /** Status in index (staged area) */
  indexStatus: FileChangeType;
  /** Status in working tree */
  workingTreeStatus: FileChangeType;
}

/**
 * Type of change for a file
 */
export type FileChangeType =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'ignored'
  | 'unchanged';

/**
 * Overall git repository status
 */
export interface GitStatus {
  /** Current branch name */
  currentBranch: string;
  /** Whether the branch is tracking a remote */
  isTracking: boolean;
  /** Remote tracking branch name (if tracking) */
  trackingBranch: string | null;
  /** Number of commits ahead of remote */
  ahead: number;
  /** Number of commits behind remote */
  behind: number;
  /** Files staged for commit */
  staged: FileStatus[];
  /** Modified files not staged */
  modified: FileStatus[];
  /** Untracked files */
  untracked: string[];
  /** Files with merge conflicts */
  conflicted: string[];
  /** Whether there are any uncommitted changes */
  isDirty: boolean;
  /** Whether there is an ongoing merge */
  isMerging: boolean;
  /** Whether there is an ongoing rebase */
  isRebasing: boolean;
}

/**
 * A checkpoint (tag) created by Sloppy
 */
export interface Checkpoint {
  /** Checkpoint name (tag name) */
  name: string;
  /** Commit hash the checkpoint points to */
  hash: string;
  /** When the checkpoint was created */
  createdAt: Date;
  /** Optional message/description */
  message: string | null;
  /** Whether this is a Sloppy-created checkpoint */
  isSloppyCheckpoint: boolean;
}

/**
 * A single hunk from a diff
 */
export interface DiffHunk {
  /** Original file start line */
  oldStart: number;
  /** Number of lines in original file */
  oldLines: number;
  /** New file start line */
  newStart: number;
  /** Number of lines in new file */
  newLines: number;
  /** The hunk header line */
  header: string;
  /** Lines in this hunk (with +/- prefix) */
  lines: DiffLine[];
}

/**
 * A single line in a diff hunk
 */
export interface DiffLine {
  /** Type of line: added, removed, or context */
  type: 'add' | 'remove' | 'context';
  /** The line content (without prefix) */
  content: string;
  /** Line number in old file (null for added lines) */
  oldLineNumber: number | null;
  /** Line number in new file (null for removed lines) */
  newLineNumber: number | null;
}

/**
 * A file change in a diff
 */
export interface DiffFile {
  /** Original file path */
  oldPath: string;
  /** New file path (different if renamed) */
  newPath: string;
  /** Type of change */
  changeType: 'add' | 'modify' | 'delete' | 'rename' | 'copy';
  /** Whether the file is binary */
  isBinary: boolean;
  /** Hunks in this file diff */
  hunks: DiffHunk[];
  /** Number of lines added */
  additions: number;
  /** Number of lines deleted */
  deletions: number;
}

/**
 * Parsed git URL components
 */
export interface ParsedGitUrl {
  /** Host (e.g., github.com) */
  host: string;
  /** Repository owner/organization */
  owner: string;
  /** Repository name */
  repo: string;
  /** Original protocol (https, ssh, git) */
  protocol: string;
}

/**
 * Options for git operations
 */
export interface GitOperationOptions {
  /** Working directory for the operation */
  cwd?: string;
  /** Timeout in milliseconds */
  timeout?: number;
  /** Whether to throw on non-zero exit */
  throwOnError?: boolean;
}

/**
 * Error thrown by git operations
 */
export class GitError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly exitCode?: number,
    public readonly stderr?: string
  ) {
    super(message);
    this.name = 'GitError';
    Error.captureStackTrace?.(this, GitError);
  }
}

/**
 * Error thrown when an operation would be dangerous
 */
export class DangerousOperationError extends GitError {
  constructor(message: string, operation: string) {
    super(message, operation);
    this.name = 'DangerousOperationError';
  }
}

/**
 * Error thrown when a commit or ref is not found
 */
export class RefNotFoundError extends GitError {
  constructor(ref: string, operation: string) {
    super(`Reference not found: ${ref}`, operation);
    this.name = 'RefNotFoundError';
  }
}

/**
 * Error thrown when there are uncommitted changes blocking an operation
 */
export class UncommittedChangesError extends GitError {
  constructor(operation: string) {
    super(
      'Operation blocked: uncommitted changes present. Commit or stash changes first.',
      operation
    );
    this.name = 'UncommittedChangesError';
  }
}
