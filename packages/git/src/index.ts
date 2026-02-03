/**
 * @sloppy/git - Git operations handler for Sloppy code quality tool
 *
 * This package provides comprehensive git operations with safety checks,
 * proper error handling, and support for Sloppy's checkpoint system.
 *
 * @example
 * ```typescript
 * import { GitManager } from '@sloppy/git';
 *
 * const git = new GitManager('/path/to/repo');
 *
 * // Create a cleaning branch
 * const branchName = await git.createCleaningBranch('session-123');
 *
 * // Make changes and commit
 * await git.stageAll();
 * const commitHash = await git.commit('Clean up code');
 *
 * // Create a checkpoint before risky changes
 * await git.createCheckpoint('before-refactor');
 * ```
 *
 * @packageDocumentation
 */

// Main class export
export { GitManager } from './manager';

// Type exports
export {
  // Core types
  CommitInfo,
  GitStatus,
  FileStatus,
  FileChangeType,
  Checkpoint,
  DiffHunk,
  DiffLine,
  DiffFile,
  ParsedGitUrl,
  GitOperationOptions,
  // Error types
  GitError,
  DangerousOperationError,
  RefNotFoundError,
  UncommittedChangesError,
} from './types';

// Diff parser exports
export {
  parseDiff,
  applyDiff,
  validateDiff,
  extractHunks,
  getDiffStats,
  formatDiff,
  invertDiff,
  getAffectedFiles,
} from './diff-parser';

// Utility exports
export {
  isValidCommitHash,
  isFullCommitHash,
  sanitizeBranchName,
  isValidBranchName,
  parseGitUrl,
  buildHttpsUrl,
  buildSshUrl,
  escapeGitArg,
  generateTimestamp,
  isPathWithinRepo,
  normalizeGitPath,
  isSafeRefName,
} from './utils';
