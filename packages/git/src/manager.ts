/**
 * GitManager - Comprehensive git operations handler for Sloppy
 */

import { simpleGit, SimpleGit, StatusResult, LogResult } from 'simple-git';
import * as path from 'path';
import {
  CommitInfo,
  GitStatus,
  FileStatus,
  FileChangeType,
  Checkpoint,
  GitError,
  DangerousOperationError,
  RefNotFoundError,
  UncommittedChangesError,
} from './types.js';
import {
  isValidCommitHash,
  sanitizeBranchName,
  isValidBranchName,
  isSafeRefName,
  generateTimestamp,
  isPathWithinRepo,
  normalizeGitPath,
} from './utils.js';

/** Prefix for Sloppy-created checkpoints */
const SLOPPY_CHECKPOINT_PREFIX = 'sloppy-checkpoint/';

/** Prefix for Sloppy-created cleaning branches */
const SLOPPY_BRANCH_PREFIX = 'sloppy/clean-';

/** Protected branch patterns that cannot be deleted */
const PROTECTED_BRANCHES = ['main', 'master', 'develop', 'production', 'staging'];

/**
 * GitManager provides a safe, comprehensive interface for git operations
 */
export class GitManager {
  private git: SimpleGit;
  private workingDir: string;

  /**
   * Creates a new GitManager instance
   * @param workingDir - The working directory for git operations
   */
  constructor(workingDir: string) {
    this.workingDir = path.resolve(workingDir);
    this.git = simpleGit(this.workingDir);
  }

  /**
   * Gets the current working directory
   */
  getWorkingDirectory(): string {
    return this.workingDir;
  }

  // ============================================================
  // Initialization Operations
  // ============================================================

  /**
   * Clones a repository to the target directory
   * @param url - The repository URL to clone
   * @param targetDir - The target directory for the clone
   */
  async clone(url: string, targetDir: string): Promise<void> {
    if (!url || typeof url !== 'string') {
      throw new GitError('Repository URL is required', 'clone');
    }
    if (!targetDir || typeof targetDir !== 'string') {
      throw new GitError('Target directory is required', 'clone');
    }

    try {
      await simpleGit().clone(url, targetDir);
    } catch (error) {
      throw new GitError(
        `Failed to clone repository: ${(error as Error).message}`,
        'clone'
      );
    }
  }

  /**
   * Initializes a new git repository
   * @param dir - The directory to initialize (defaults to working directory)
   */
  async init(dir?: string): Promise<void> {
    const targetDir = dir ? path.resolve(dir) : this.workingDir;

    try {
      await simpleGit(targetDir).init();
    } catch (error) {
      throw new GitError(
        `Failed to initialize repository: ${(error as Error).message}`,
        'init'
      );
    }
  }

  /**
   * Checks if a directory is a git repository
   * @param dir - The directory to check (defaults to working directory)
   * @returns True if the directory is a git repository
   */
  async isGitRepo(dir?: string): Promise<boolean> {
    const targetDir = dir ? path.resolve(dir) : this.workingDir;

    try {
      await simpleGit(targetDir).revparse(['--git-dir']);
      return true;
    } catch {
      return false;
    }
  }

  // ============================================================
  // Branch Operations
  // ============================================================

  /**
   * Creates a new branch
   * @param name - The branch name
   */
  async createBranch(name: string): Promise<void> {
    if (!isValidBranchName(name)) {
      throw new GitError(`Invalid branch name: ${name}`, 'createBranch');
    }
    if (!isSafeRefName(name)) {
      throw new DangerousOperationError(
        'Branch name contains potentially dangerous characters',
        'createBranch'
      );
    }

    try {
      await this.git.checkoutLocalBranch(name);
    } catch (error) {
      throw new GitError(
        `Failed to create branch: ${(error as Error).message}`,
        'createBranch'
      );
    }
  }

  /**
   * Switches to an existing branch
   * @param name - The branch name to switch to
   */
  async switchBranch(name: string): Promise<void> {
    if (!isSafeRefName(name)) {
      throw new DangerousOperationError(
        'Branch name contains potentially dangerous characters',
        'switchBranch'
      );
    }

    try {
      await this.git.checkout(name);
    } catch (error) {
      throw new GitError(
        `Failed to switch to branch '${name}': ${(error as Error).message}`,
        'switchBranch'
      );
    }
  }

  /**
   * Gets the current branch name
   * @returns The current branch name
   */
  async getCurrentBranch(): Promise<string> {
    try {
      const result = await this.git.revparse(['--abbrev-ref', 'HEAD']);
      return result.trim();
    } catch (error) {
      throw new GitError(
        `Failed to get current branch: ${(error as Error).message}`,
        'getCurrentBranch'
      );
    }
  }

  /**
   * Lists all local branches
   * @returns Array of branch names
   */
  async listBranches(): Promise<string[]> {
    try {
      const result = await this.git.branchLocal();
      return result.all;
    } catch (error) {
      throw new GitError(
        `Failed to list branches: ${(error as Error).message}`,
        'listBranches'
      );
    }
  }

  /**
   * Deletes a branch
   * @param name - The branch name to delete
   */
  async deleteBranch(name: string): Promise<void> {
    if (!isSafeRefName(name)) {
      throw new DangerousOperationError(
        'Branch name contains potentially dangerous characters',
        'deleteBranch'
      );
    }

    // Prevent deletion of protected branches
    const lowerName = name.toLowerCase();
    if (PROTECTED_BRANCHES.some(b => lowerName === b || lowerName.endsWith(`/${b}`))) {
      throw new DangerousOperationError(
        `Cannot delete protected branch: ${name}`,
        'deleteBranch'
      );
    }

    // Cannot delete current branch
    const currentBranch = await this.getCurrentBranch();
    if (currentBranch === name) {
      throw new GitError(
        'Cannot delete the currently checked out branch',
        'deleteBranch'
      );
    }

    try {
      await this.git.deleteLocalBranch(name, true);
    } catch (error) {
      throw new GitError(
        `Failed to delete branch '${name}': ${(error as Error).message}`,
        'deleteBranch'
      );
    }
  }

  /**
   * Creates a cleaning branch with Sloppy naming convention
   * @param sessionId - The session identifier
   * @returns The created branch name
   */
  async createCleaningBranch(sessionId: string): Promise<string> {
    const sanitizedId = sanitizeBranchName(sessionId);
    const timestamp = generateTimestamp();
    const branchName = `${SLOPPY_BRANCH_PREFIX}${sanitizedId}-${timestamp}`;

    await this.createBranch(branchName);
    return branchName;
  }

  // ============================================================
  // Commit Operations
  // ============================================================

  /**
   * Stages specific files for commit
   * @param files - Array of file paths to stage
   */
  async stage(files: string[]): Promise<void> {
    if (!files || files.length === 0) {
      throw new GitError('No files specified to stage', 'stage');
    }

    // Validate all paths are within repository
    for (const file of files) {
      const normalized = normalizeGitPath(file);
      if (!isPathWithinRepo(this.workingDir, normalized)) {
        throw new DangerousOperationError(
          `Path outside repository: ${file}`,
          'stage'
        );
      }
    }

    try {
      await this.git.add(files);
    } catch (error) {
      throw new GitError(
        `Failed to stage files: ${(error as Error).message}`,
        'stage'
      );
    }
  }

  /**
   * Stages all changes for commit
   */
  async stageAll(): Promise<void> {
    try {
      await this.git.add('-A');
    } catch (error) {
      throw new GitError(
        `Failed to stage all files: ${(error as Error).message}`,
        'stageAll'
      );
    }
  }

  /**
   * Creates a commit with the staged changes
   * @param message - The commit message
   * @returns The commit hash
   */
  async commit(message: string): Promise<string> {
    if (!message || typeof message !== 'string' || !message.trim()) {
      throw new GitError('Commit message is required', 'commit');
    }

    try {
      const result = await this.git.commit(message);
      return result.commit;
    } catch (error) {
      throw new GitError(
        `Failed to create commit: ${(error as Error).message}`,
        'commit'
      );
    }
  }

  /**
   * Gets the commit history
   * @param count - Number of commits to retrieve
   * @returns Array of CommitInfo objects
   */
  async getCommitHistory(count: number = 10): Promise<CommitInfo[]> {
    if (count < 1 || count > 1000) {
      throw new GitError('Count must be between 1 and 1000', 'getCommitHistory');
    }

    try {
      const log: LogResult = await this.git.log({ maxCount: count });

      return log.all.map(entry => ({
        hash: entry.hash,
        shortHash: entry.hash.substring(0, 7),
        message: entry.message.split('\n')[0],
        fullMessage: entry.message,
        authorName: entry.author_name,
        authorEmail: entry.author_email,
        date: new Date(entry.date),
        parents: entry.refs ? entry.refs.split(',').map(r => r.trim()) : [],
      }));
    } catch (error) {
      throw new GitError(
        `Failed to get commit history: ${(error as Error).message}`,
        'getCommitHistory'
      );
    }
  }

  /**
   * Gets the diff for a specific commit
   * @param hash - The commit hash
   * @returns The diff string
   */
  async getCommitDiff(hash: string): Promise<string> {
    if (!isValidCommitHash(hash)) {
      throw new GitError(`Invalid commit hash: ${hash}`, 'getCommitDiff');
    }
    if (!isSafeRefName(hash)) {
      throw new DangerousOperationError(
        'Commit hash contains potentially dangerous characters',
        'getCommitDiff'
      );
    }

    try {
      return await this.git.show([hash, '--format=']);
    } catch (error) {
      if ((error as Error).message.includes('unknown revision')) {
        throw new RefNotFoundError(hash, 'getCommitDiff');
      }
      throw new GitError(
        `Failed to get commit diff: ${(error as Error).message}`,
        'getCommitDiff'
      );
    }
  }

  // ============================================================
  // Diff Operations
  // ============================================================

  /**
   * Gets the diff of unstaged changes
   * @returns The diff string
   */
  async getDiff(): Promise<string> {
    try {
      return await this.git.diff();
    } catch (error) {
      throw new GitError(
        `Failed to get diff: ${(error as Error).message}`,
        'getDiff'
      );
    }
  }

  /**
   * Gets the diff of staged changes
   * @returns The diff string
   */
  async getStagedDiff(): Promise<string> {
    try {
      return await this.git.diff(['--cached']);
    } catch (error) {
      throw new GitError(
        `Failed to get staged diff: ${(error as Error).message}`,
        'getStagedDiff'
      );
    }
  }

  /**
   * Gets the diff between two commits
   * @param from - The starting commit hash
   * @param to - The ending commit hash
   * @returns The diff string
   */
  async getDiffBetweenCommits(from: string, to: string): Promise<string> {
    if (!isValidCommitHash(from)) {
      throw new GitError(`Invalid 'from' commit hash: ${from}`, 'getDiffBetweenCommits');
    }
    if (!isValidCommitHash(to)) {
      throw new GitError(`Invalid 'to' commit hash: ${to}`, 'getDiffBetweenCommits');
    }
    if (!isSafeRefName(from) || !isSafeRefName(to)) {
      throw new DangerousOperationError(
        'Commit hash contains potentially dangerous characters',
        'getDiffBetweenCommits'
      );
    }

    try {
      return await this.git.diff([from, to]);
    } catch (error) {
      throw new GitError(
        `Failed to get diff between commits: ${(error as Error).message}`,
        'getDiffBetweenCommits'
      );
    }
  }

  /**
   * Gets the diff for a specific file
   * @param filePath - The file path
   * @returns The diff string
   */
  async getFileDiff(filePath: string): Promise<string> {
    const normalized = normalizeGitPath(filePath);

    if (!isPathWithinRepo(this.workingDir, normalized)) {
      throw new DangerousOperationError(
        `Path outside repository: ${filePath}`,
        'getFileDiff'
      );
    }

    try {
      return await this.git.diff(['--', normalized]);
    } catch (error) {
      throw new GitError(
        `Failed to get file diff: ${(error as Error).message}`,
        'getFileDiff'
      );
    }
  }

  // ============================================================
  // Revert Operations
  // ============================================================

  /**
   * Reverts a specific commit (creates a new commit that undoes the changes)
   * @param hash - The commit hash to revert
   */
  async revertCommit(hash: string): Promise<void> {
    if (!isValidCommitHash(hash)) {
      throw new GitError(`Invalid commit hash: ${hash}`, 'revertCommit');
    }
    if (!isSafeRefName(hash)) {
      throw new DangerousOperationError(
        'Commit hash contains potentially dangerous characters',
        'revertCommit'
      );
    }

    try {
      await this.git.revert(hash, { '--no-edit': null });
    } catch (error) {
      throw new GitError(
        `Failed to revert commit: ${(error as Error).message}`,
        'revertCommit'
      );
    }
  }

  /**
   * Hard resets to a specific commit (DESTRUCTIVE - loses all changes after that commit)
   * @param hash - The commit hash to reset to
   */
  async revertToCommit(hash: string): Promise<void> {
    if (!isValidCommitHash(hash)) {
      throw new GitError(`Invalid commit hash: ${hash}`, 'revertToCommit');
    }
    if (!isSafeRefName(hash)) {
      throw new DangerousOperationError(
        'Commit hash contains potentially dangerous characters',
        'revertToCommit'
      );
    }

    // Warn about uncommitted changes
    const hasChanges = await this.hasUncommittedChanges();
    if (hasChanges) {
      throw new UncommittedChangesError('revertToCommit');
    }

    try {
      await this.git.reset(['--hard', hash]);
    } catch (error) {
      throw new GitError(
        `Failed to reset to commit: ${(error as Error).message}`,
        'revertToCommit'
      );
    }
  }

  /**
   * Cherry-picks a commit onto the current branch
   * @param hash - The commit hash to cherry-pick
   */
  async cherryPick(hash: string): Promise<void> {
    if (!isValidCommitHash(hash)) {
      throw new GitError(`Invalid commit hash: ${hash}`, 'cherryPick');
    }
    if (!isSafeRefName(hash)) {
      throw new DangerousOperationError(
        'Commit hash contains potentially dangerous characters',
        'cherryPick'
      );
    }

    try {
      await this.git.raw(['cherry-pick', hash]);
    } catch (error) {
      throw new GitError(
        `Failed to cherry-pick commit: ${(error as Error).message}`,
        'cherryPick'
      );
    }
  }

  /**
   * Reverts multiple commits in order
   * @param hashes - Array of commit hashes to revert (in order)
   */
  async revertMultiple(hashes: string[]): Promise<void> {
    if (!hashes || hashes.length === 0) {
      throw new GitError('No commits specified to revert', 'revertMultiple');
    }

    // Validate all hashes first
    for (const hash of hashes) {
      if (!isValidCommitHash(hash)) {
        throw new GitError(`Invalid commit hash: ${hash}`, 'revertMultiple');
      }
      if (!isSafeRefName(hash)) {
        throw new DangerousOperationError(
          `Commit hash contains potentially dangerous characters: ${hash}`,
          'revertMultiple'
        );
      }
    }

    // Revert in order
    for (const hash of hashes) {
      await this.revertCommit(hash);
    }
  }

  // ============================================================
  // File Operations
  // ============================================================

  /**
   * Gets all tracked files in the repository
   * @returns Array of file paths
   */
  async getTrackedFiles(): Promise<string[]> {
    try {
      const result = await this.git.raw(['ls-files']);
      return result.trim().split('\n').filter(f => f);
    } catch (error) {
      throw new GitError(
        `Failed to get tracked files: ${(error as Error).message}`,
        'getTrackedFiles'
      );
    }
  }

  /**
   * Gets all modified files (staged and unstaged)
   * @returns Array of file paths
   */
  async getModifiedFiles(): Promise<string[]> {
    try {
      const status = await this.git.status();
      const modified = new Set<string>();

      for (const file of status.modified) {
        modified.add(file);
      }
      for (const file of status.staged) {
        modified.add(file);
      }
      for (const file of status.renamed) {
        modified.add(file.to);
      }

      return Array.from(modified);
    } catch (error) {
      throw new GitError(
        `Failed to get modified files: ${(error as Error).message}`,
        'getModifiedFiles'
      );
    }
  }

  /**
   * Gets all untracked files
   * @returns Array of file paths
   */
  async getUntrackedFiles(): Promise<string[]> {
    try {
      const status = await this.git.status();
      return status.not_added;
    } catch (error) {
      throw new GitError(
        `Failed to get untracked files: ${(error as Error).message}`,
        'getUntrackedFiles'
      );
    }
  }

  /**
   * Checks out a file from a specific commit or discards changes
   * @param filePath - The file path
   * @param commit - Optional commit to checkout from (defaults to HEAD)
   */
  async checkoutFile(filePath: string, commit?: string): Promise<void> {
    const normalized = normalizeGitPath(filePath);

    if (!isPathWithinRepo(this.workingDir, normalized)) {
      throw new DangerousOperationError(
        `Path outside repository: ${filePath}`,
        'checkoutFile'
      );
    }

    if (commit && !isSafeRefName(commit)) {
      throw new DangerousOperationError(
        'Commit reference contains potentially dangerous characters',
        'checkoutFile'
      );
    }

    try {
      if (commit) {
        await this.git.checkout([commit, '--', normalized]);
      } else {
        await this.git.checkout(['--', normalized]);
      }
    } catch (error) {
      throw new GitError(
        `Failed to checkout file: ${(error as Error).message}`,
        'checkoutFile'
      );
    }
  }

  /**
   * Gets the content of a file at a specific commit
   * @param filePath - The file path
   * @param commit - The commit hash or reference
   * @returns The file content
   */
  async getFileAtCommit(filePath: string, commit: string): Promise<string> {
    const normalized = normalizeGitPath(filePath);

    if (!isPathWithinRepo(this.workingDir, normalized)) {
      throw new DangerousOperationError(
        `Path outside repository: ${filePath}`,
        'getFileAtCommit'
      );
    }
    if (!isSafeRefName(commit)) {
      throw new DangerousOperationError(
        'Commit reference contains potentially dangerous characters',
        'getFileAtCommit'
      );
    }

    try {
      return await this.git.show([`${commit}:${normalized}`]);
    } catch (error) {
      throw new GitError(
        `Failed to get file at commit: ${(error as Error).message}`,
        'getFileAtCommit'
      );
    }
  }

  // ============================================================
  // Status Operations
  // ============================================================

  /**
   * Gets the comprehensive repository status
   * @returns GitStatus object
   */
  async getStatus(): Promise<GitStatus> {
    try {
      const status: StatusResult = await this.git.status();

      const mapFileStatus = (files: string[], type: FileChangeType): FileStatus[] =>
        files.map(path => ({
          path,
          indexStatus: type,
          workingTreeStatus: 'unchanged' as FileChangeType,
        }));

      return {
        currentBranch: status.current || 'HEAD',
        isTracking: !!status.tracking,
        trackingBranch: status.tracking || null,
        ahead: status.ahead,
        behind: status.behind,
        staged: mapFileStatus(status.staged, 'modified'),
        modified: mapFileStatus(status.modified, 'modified'),
        untracked: status.not_added,
        conflicted: status.conflicted,
        isDirty: !status.isClean(),
        isMerging: status.conflicted.length > 0,
        isRebasing: false, // Would need additional check
      };
    } catch (error) {
      throw new GitError(
        `Failed to get status: ${(error as Error).message}`,
        'getStatus'
      );
    }
  }

  /**
   * Checks if there are uncommitted changes
   * @returns True if there are uncommitted changes
   */
  async hasUncommittedChanges(): Promise<boolean> {
    try {
      const status = await this.git.status();
      return !status.isClean();
    } catch (error) {
      throw new GitError(
        `Failed to check for uncommitted changes: ${(error as Error).message}`,
        'hasUncommittedChanges'
      );
    }
  }

  /**
   * Checks if there are commits not pushed to remote
   * @returns True if there are unpushed commits
   */
  async hasUnpushedCommits(): Promise<boolean> {
    try {
      const status = await this.git.status();
      return status.ahead > 0;
    } catch (error) {
      // If not tracking a remote, consider as having unpushed commits
      return true;
    }
  }

  // ============================================================
  // Checkpoint System
  // ============================================================

  /**
   * Creates a checkpoint (tag) at the current commit
   * @param name - The checkpoint name
   * @returns The full checkpoint tag name
   */
  async createCheckpoint(name: string): Promise<string> {
    const sanitized = sanitizeBranchName(name);
    const tagName = `${SLOPPY_CHECKPOINT_PREFIX}${sanitized}`;

    if (!isSafeRefName(tagName)) {
      throw new DangerousOperationError(
        'Checkpoint name contains potentially dangerous characters',
        'createCheckpoint'
      );
    }

    try {
      const timestamp = new Date().toISOString();
      await this.git.tag(['-a', tagName, '-m', `Sloppy checkpoint: ${name}\nCreated: ${timestamp}`]);
      return tagName;
    } catch (error) {
      throw new GitError(
        `Failed to create checkpoint: ${(error as Error).message}`,
        'createCheckpoint'
      );
    }
  }

  /**
   * Lists all Sloppy checkpoints
   * @returns Array of Checkpoint objects
   */
  async listCheckpoints(): Promise<Checkpoint[]> {
    try {
      const tags = await this.git.tags();
      const checkpoints: Checkpoint[] = [];

      for (const tag of tags.all) {
        const isSloppyCheckpoint = tag.startsWith(SLOPPY_CHECKPOINT_PREFIX);

        try {
          // Get tag details
          const showResult = await this.git.raw([
            'tag', '-l', tag, '--format=%(objectname) %(creatordate:iso-strict) %(contents)'
          ]);

          const parts = showResult.trim().split(' ');
          const hash = parts[0] ?? '';
          const dateStr = parts[1] ?? '';
          const message = parts.slice(2).join(' ') || null;

          checkpoints.push({
            name: tag,
            hash,
            createdAt: dateStr ? new Date(dateStr) : new Date(),
            message,
            isSloppyCheckpoint,
          });
        } catch {
          // If we can't get details, add with minimal info
          checkpoints.push({
            name: tag,
            hash: '',
            createdAt: new Date(),
            message: null,
            isSloppyCheckpoint,
          });
        }
      }

      return checkpoints.filter(cp => cp.isSloppyCheckpoint);
    } catch (error) {
      throw new GitError(
        `Failed to list checkpoints: ${(error as Error).message}`,
        'listCheckpoints'
      );
    }
  }

  /**
   * Restores a checkpoint (checks out the tagged commit)
   * @param name - The checkpoint name (with or without prefix)
   */
  async restoreCheckpoint(name: string): Promise<void> {
    const tagName = name.startsWith(SLOPPY_CHECKPOINT_PREFIX)
      ? name
      : `${SLOPPY_CHECKPOINT_PREFIX}${name}`;

    if (!isSafeRefName(tagName)) {
      throw new DangerousOperationError(
        'Checkpoint name contains potentially dangerous characters',
        'restoreCheckpoint'
      );
    }

    // Check for uncommitted changes
    const hasChanges = await this.hasUncommittedChanges();
    if (hasChanges) {
      throw new UncommittedChangesError('restoreCheckpoint');
    }

    try {
      await this.git.checkout(tagName);
    } catch (error) {
      if ((error as Error).message.includes('did not match')) {
        throw new RefNotFoundError(tagName, 'restoreCheckpoint');
      }
      throw new GitError(
        `Failed to restore checkpoint: ${(error as Error).message}`,
        'restoreCheckpoint'
      );
    }
  }

  /**
   * Deletes a checkpoint
   * @param name - The checkpoint name (with or without prefix)
   */
  async deleteCheckpoint(name: string): Promise<void> {
    const tagName = name.startsWith(SLOPPY_CHECKPOINT_PREFIX)
      ? name
      : `${SLOPPY_CHECKPOINT_PREFIX}${name}`;

    if (!isSafeRefName(tagName)) {
      throw new DangerousOperationError(
        'Checkpoint name contains potentially dangerous characters',
        'deleteCheckpoint'
      );
    }

    try {
      await this.git.tag(['-d', tagName]);
    } catch (error) {
      if ((error as Error).message.includes('not found')) {
        throw new RefNotFoundError(tagName, 'deleteCheckpoint');
      }
      throw new GitError(
        `Failed to delete checkpoint: ${(error as Error).message}`,
        'deleteCheckpoint'
      );
    }
  }
}
