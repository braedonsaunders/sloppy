/**
 * Git utility functions for @sloppy/git
 */

import { ParsedGitUrl } from './types';

/**
 * Validates if a string is a valid commit hash (full or abbreviated)
 * @param hash - The string to validate
 * @returns True if the string is a valid commit hash format
 */
export function isValidCommitHash(hash: string): boolean {
  if (!hash || typeof hash !== 'string') {
    return false;
  }

  // Git commit hashes are hexadecimal
  // Full hash is 40 characters, abbreviated can be 4-40 characters
  const hexRegex = /^[a-f0-9]+$/i;

  if (!hexRegex.test(hash)) {
    return false;
  }

  // Minimum 4 characters for abbreviated hash, maximum 40 for full hash
  return hash.length >= 4 && hash.length <= 40;
}

/**
 * Validates if a string is a full (40-character) commit hash
 * @param hash - The string to validate
 * @returns True if the string is a valid full commit hash
 */
export function isFullCommitHash(hash: string): boolean {
  if (!hash || typeof hash !== 'string') {
    return false;
  }

  const fullHashRegex = /^[a-f0-9]{40}$/i;
  return fullHashRegex.test(hash);
}

/**
 * Sanitizes a string to be a valid git branch name
 * Rules:
 * - Cannot begin with '.'
 * - Cannot contain '..'
 * - Cannot contain special characters: ~ ^ : \ ? * [ @{ space
 * - Cannot end with '/'
 * - Cannot end with '.lock'
 * - Cannot be '@'
 *
 * @param name - The branch name to sanitize
 * @returns A sanitized branch name
 */
export function sanitizeBranchName(name: string): string {
  if (!name || typeof name !== 'string') {
    throw new Error('Branch name must be a non-empty string');
  }

  let sanitized = name.trim();

  // Replace spaces and invalid characters with hyphens
  sanitized = sanitized.replace(/[\s~^:?*\[\]@{\\]/g, '-');

  // Replace consecutive dots with single dot
  sanitized = sanitized.replace(/\.{2,}/g, '.');

  // Remove leading dots
  sanitized = sanitized.replace(/^\.+/, '');

  // Remove trailing slashes
  sanitized = sanitized.replace(/\/+$/, '');

  // Remove .lock suffix if present
  sanitized = sanitized.replace(/\.lock$/, '');

  // Replace consecutive hyphens with single hyphen
  sanitized = sanitized.replace(/-{2,}/g, '-');

  // Remove leading and trailing hyphens
  sanitized = sanitized.replace(/^-+|-+$/g, '');

  // Handle the edge case of '@'
  if (sanitized === '@') {
    sanitized = 'at';
  }

  // Ensure the result is not empty
  if (!sanitized) {
    throw new Error('Branch name is empty after sanitization');
  }

  return sanitized;
}

/**
 * Validates if a branch name is valid (without sanitizing)
 * @param name - The branch name to validate
 * @returns True if the branch name is valid
 */
export function isValidBranchName(name: string): boolean {
  if (!name || typeof name !== 'string') {
    return false;
  }

  // Cannot be '@'
  if (name === '@') {
    return false;
  }

  // Cannot begin with '.'
  if (name.startsWith('.')) {
    return false;
  }

  // Cannot end with '/'
  if (name.endsWith('/')) {
    return false;
  }

  // Cannot end with '.lock'
  if (name.endsWith('.lock')) {
    return false;
  }

  // Cannot contain '..'
  if (name.includes('..')) {
    return false;
  }

  // Cannot contain special characters
  const invalidChars = /[\s~^:?*\[\]@{\\]/;
  if (invalidChars.test(name)) {
    return false;
  }

  return true;
}

/**
 * Parses a git URL (HTTPS or SSH) into its components
 * Supports formats:
 * - https://github.com/owner/repo.git
 * - git@github.com:owner/repo.git
 * - ssh://git@github.com/owner/repo.git
 * - git://github.com/owner/repo.git
 *
 * @param url - The git URL to parse
 * @returns Parsed URL components
 */
export function parseGitUrl(url: string): ParsedGitUrl {
  if (!url || typeof url !== 'string') {
    throw new Error('URL must be a non-empty string');
  }

  const trimmedUrl = url.trim();

  // Try SSH format: git@host:owner/repo.git
  const sshRegex = /^git@([^:]+):([^/]+)\/(.+?)(?:\.git)?$/;
  const sshMatch = trimmedUrl.match(sshRegex);
  if (sshMatch) {
    return {
      protocol: 'ssh',
      host: sshMatch[1],
      owner: sshMatch[2],
      repo: sshMatch[3],
    };
  }

  // Try URL format: protocol://[user@]host/owner/repo[.git]
  const urlRegex = /^(https?|ssh|git):\/\/(?:[^@]+@)?([^/]+)\/([^/]+)\/(.+?)(?:\.git)?$/;
  const urlMatch = trimmedUrl.match(urlRegex);
  if (urlMatch) {
    return {
      protocol: urlMatch[1],
      host: urlMatch[2],
      owner: urlMatch[3],
      repo: urlMatch[4],
    };
  }

  // Try simple format: host/owner/repo
  const simpleRegex = /^([^/]+)\/([^/]+)\/(.+?)(?:\.git)?$/;
  const simpleMatch = trimmedUrl.match(simpleRegex);
  if (simpleMatch) {
    return {
      protocol: 'https',
      host: simpleMatch[1],
      owner: simpleMatch[2],
      repo: simpleMatch[3],
    };
  }

  throw new Error(`Unable to parse git URL: ${url}`);
}

/**
 * Constructs an HTTPS git URL from components
 * @param host - The git host (e.g., github.com)
 * @param owner - The repository owner
 * @param repo - The repository name
 * @returns HTTPS git URL
 */
export function buildHttpsUrl(host: string, owner: string, repo: string): string {
  return `https://${host}/${owner}/${repo}.git`;
}

/**
 * Constructs an SSH git URL from components
 * @param host - The git host (e.g., github.com)
 * @param owner - The repository owner
 * @param repo - The repository name
 * @returns SSH git URL
 */
export function buildSshUrl(host: string, owner: string, repo: string): string {
  return `git@${host}:${owner}/${repo}.git`;
}

/**
 * Escapes a string for safe use in git commands
 * @param str - The string to escape
 * @returns Escaped string
 */
export function escapeGitArg(str: string): string {
  if (!str) {
    return '';
  }
  // Escape backslashes and double quotes
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Generates a timestamp string suitable for branch names
 * @returns Timestamp in format YYYYMMDD-HHMMSS
 */
export function generateTimestamp(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');

  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

/**
 * Checks if a path is within a git repository root
 * (Prevents path traversal attacks)
 * @param repoRoot - The repository root path
 * @param targetPath - The target path to check
 * @returns True if the target is within the repo root
 */
export function isPathWithinRepo(repoRoot: string, targetPath: string): boolean {
  const path = require('path');
  const resolvedRoot = path.resolve(repoRoot);
  const resolvedTarget = path.resolve(repoRoot, targetPath);

  return resolvedTarget.startsWith(resolvedRoot + path.sep) ||
         resolvedTarget === resolvedRoot;
}

/**
 * Normalizes a file path for git (forward slashes, no leading ./)
 * @param filePath - The file path to normalize
 * @returns Normalized path
 */
export function normalizeGitPath(filePath: string): string {
  if (!filePath) {
    return '';
  }

  let normalized = filePath.replace(/\\/g, '/');

  // Remove leading ./
  normalized = normalized.replace(/^\.\//, '');

  // Remove trailing /
  normalized = normalized.replace(/\/$/, '');

  return normalized;
}

/**
 * Checks if a ref name looks like it could be dangerous
 * (e.g., contains shell metacharacters)
 * @param ref - The ref name to check
 * @returns True if the ref appears safe
 */
export function isSafeRefName(ref: string): boolean {
  if (!ref || typeof ref !== 'string') {
    return false;
  }

  // Disallow shell metacharacters
  const dangerousChars = /[;&|`$(){}!<>]/;
  if (dangerousChars.test(ref)) {
    return false;
  }

  // Disallow newlines
  if (ref.includes('\n') || ref.includes('\r')) {
    return false;
  }

  return true;
}
