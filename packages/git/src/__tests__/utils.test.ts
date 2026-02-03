import { describe, it, expect } from 'vitest';
import {
  isValidCommitHash,
  sanitizeBranchName,
  isValidBranchName,
  formatCommitMessage,
  parseGitStatus,
  GitStatusCode,
} from '../utils.js';

describe('isValidCommitHash', () => {
  it('should validate full 40-char SHA', () => {
    expect(isValidCommitHash('a'.repeat(40))).toBe(true);
    expect(isValidCommitHash('1234567890abcdef1234567890abcdef12345678')).toBe(true);
  });

  it('should validate short 7-char SHA', () => {
    expect(isValidCommitHash('abc1234')).toBe(true);
    expect(isValidCommitHash('1234567')).toBe(true);
  });

  it('should reject invalid hashes', () => {
    expect(isValidCommitHash('')).toBe(false);
    expect(isValidCommitHash('abc')).toBe(false);
    expect(isValidCommitHash('xyz1234')).toBe(false); // non-hex
    expect(isValidCommitHash('a'.repeat(41))).toBe(false); // too long
  });
});

describe('sanitizeBranchName', () => {
  it('should sanitize invalid characters', () => {
    expect(sanitizeBranchName('feature/my branch')).toBe('feature/my-branch');
    expect(sanitizeBranchName('feature..name')).toBe('feature.name');
    expect(sanitizeBranchName('feature~name^test')).toBe('feature-name-test');
  });

  it('should handle special patterns', () => {
    expect(sanitizeBranchName('feature@{test}')).toBe('feature-test');
    expect(sanitizeBranchName('feature\\path')).toBe('feature-path');
  });

  it('should trim leading/trailing special chars', () => {
    expect(sanitizeBranchName('.feature')).toBe('feature');
    expect(sanitizeBranchName('feature.')).toBe('feature');
    expect(sanitizeBranchName('/feature/')).toBe('feature');
  });

  it('should convert to lowercase', () => {
    expect(sanitizeBranchName('Feature/MyBranch')).toBe('feature/mybranch');
  });
});

describe('isValidBranchName', () => {
  it('should accept valid branch names', () => {
    expect(isValidBranchName('main')).toBe(true);
    expect(isValidBranchName('feature/new-feature')).toBe(true);
    expect(isValidBranchName('fix/bug-123')).toBe(true);
    expect(isValidBranchName('release/v1.0.0')).toBe(true);
  });

  it('should reject invalid branch names', () => {
    expect(isValidBranchName('')).toBe(false);
    expect(isValidBranchName('.hidden')).toBe(false);
    expect(isValidBranchName('feature..double')).toBe(false);
    expect(isValidBranchName('feature.lock')).toBe(false);
    expect(isValidBranchName('feature/end/')).toBe(false);
  });
});

describe('formatCommitMessage', () => {
  it('should format simple message', () => {
    const result = formatCommitMessage('fix', 'button', 'resolve click issue');
    expect(result).toBe('fix(button): resolve click issue');
  });

  it('should handle message without scope', () => {
    const result = formatCommitMessage('docs', undefined, 'update readme');
    expect(result).toBe('docs: update readme');
  });

  it('should truncate long messages', () => {
    const longMessage = 'a'.repeat(100);
    const result = formatCommitMessage('fix', 'test', longMessage);
    expect(result.length).toBeLessThanOrEqual(72);
    expect(result).toContain('...');
  });

  it('should add body when provided', () => {
    const result = formatCommitMessage('feat', 'api', 'add endpoint', 'Detailed description here');
    expect(result).toContain('feat(api): add endpoint');
    expect(result).toContain('\n\nDetailed description here');
  });
});

describe('parseGitStatus', () => {
  it('should parse staged modifications', () => {
    const result = parseGitStatus('M  src/index.ts');
    expect(result).toEqual({
      path: 'src/index.ts',
      indexStatus: GitStatusCode.MODIFIED,
      workTreeStatus: GitStatusCode.UNMODIFIED,
    });
  });

  it('should parse unstaged modifications', () => {
    const result = parseGitStatus(' M src/index.ts');
    expect(result).toEqual({
      path: 'src/index.ts',
      indexStatus: GitStatusCode.UNMODIFIED,
      workTreeStatus: GitStatusCode.MODIFIED,
    });
  });

  it('should parse added files', () => {
    const result = parseGitStatus('A  src/new.ts');
    expect(result).toEqual({
      path: 'src/new.ts',
      indexStatus: GitStatusCode.ADDED,
      workTreeStatus: GitStatusCode.UNMODIFIED,
    });
  });

  it('should parse deleted files', () => {
    const result = parseGitStatus('D  src/old.ts');
    expect(result).toEqual({
      path: 'src/old.ts',
      indexStatus: GitStatusCode.DELETED,
      workTreeStatus: GitStatusCode.UNMODIFIED,
    });
  });

  it('should parse untracked files', () => {
    const result = parseGitStatus('?? src/untracked.ts');
    expect(result).toEqual({
      path: 'src/untracked.ts',
      indexStatus: GitStatusCode.UNTRACKED,
      workTreeStatus: GitStatusCode.UNTRACKED,
    });
  });

  it('should parse renamed files', () => {
    const result = parseGitStatus('R  old.ts -> new.ts');
    expect(result).toEqual({
      path: 'new.ts',
      indexStatus: GitStatusCode.RENAMED,
      workTreeStatus: GitStatusCode.UNMODIFIED,
      originalPath: 'old.ts',
    });
  });
});
