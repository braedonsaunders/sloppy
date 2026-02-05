import { describe, it, expect } from 'vitest';
import {
  isValidCommitHash,
  isFullCommitHash,
  sanitizeBranchName,
  isValidBranchName,
  parseGitUrl,
  buildHttpsUrl,
  buildSshUrl,
  escapeGitArg,
  normalizeGitPath,
  isSafeRefName,
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

describe('isFullCommitHash', () => {
  it('should accept 40-char hex strings', () => {
    expect(isFullCommitHash('a'.repeat(40))).toBe(true);
    expect(isFullCommitHash('1234567890abcdef1234567890abcdef12345678')).toBe(true);
  });

  it('should reject short hashes', () => {
    expect(isFullCommitHash('abc1234')).toBe(false);
    expect(isFullCommitHash('a'.repeat(39))).toBe(false);
  });

  it('should reject invalid input', () => {
    expect(isFullCommitHash('')).toBe(false);
    expect(isFullCommitHash('g'.repeat(40))).toBe(false); // non-hex
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

  it('should trim leading dots', () => {
    expect(sanitizeBranchName('.feature')).toBe('feature');
  });

  it('should trim trailing slashes', () => {
    expect(sanitizeBranchName('feature/')).toBe('feature');
  });

  it('should throw for empty input', () => {
    expect(() => sanitizeBranchName('')).toThrow();
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

describe('parseGitUrl', () => {
  it('should parse HTTPS URL', () => {
    const result = parseGitUrl('https://github.com/owner/repo.git');

    expect(result.protocol).toBe('https');
    expect(result.host).toBe('github.com');
    expect(result.owner).toBe('owner');
    expect(result.repo).toBe('repo');
  });

  it('should parse SSH URL', () => {
    const result = parseGitUrl('git@github.com:owner/repo.git');

    expect(result.protocol).toBe('ssh');
    expect(result.host).toBe('github.com');
    expect(result.owner).toBe('owner');
    expect(result.repo).toBe('repo');
  });

  it('should parse HTTPS URL without .git suffix', () => {
    const result = parseGitUrl('https://github.com/owner/repo');

    expect(result.host).toBe('github.com');
    expect(result.owner).toBe('owner');
    expect(result.repo).toBe('repo');
  });

  it('should parse SSH URL without .git suffix', () => {
    const result = parseGitUrl('git@github.com:owner/repo');

    expect(result.host).toBe('github.com');
    expect(result.owner).toBe('owner');
    expect(result.repo).toBe('repo');
  });

  it('should throw for invalid URL', () => {
    expect(() => parseGitUrl('')).toThrow();
    expect(() => parseGitUrl('not-a-url')).toThrow();
  });
});

describe('buildHttpsUrl', () => {
  it('should build correct HTTPS URL', () => {
    expect(buildHttpsUrl('github.com', 'owner', 'repo')).toBe(
      'https://github.com/owner/repo.git'
    );
  });
});

describe('buildSshUrl', () => {
  it('should build correct SSH URL', () => {
    expect(buildSshUrl('github.com', 'owner', 'repo')).toBe(
      'git@github.com:owner/repo.git'
    );
  });
});

describe('escapeGitArg', () => {
  it('should escape backslashes and quotes', () => {
    expect(escapeGitArg('hello "world"')).toBe('hello \\"world\\"');
    expect(escapeGitArg('path\\to\\file')).toBe('path\\\\to\\\\file');
  });

  it('should return empty string for empty input', () => {
    expect(escapeGitArg('')).toBe('');
  });
});

describe('normalizeGitPath', () => {
  it('should convert backslashes to forward slashes', () => {
    expect(normalizeGitPath('src\\utils\\index.ts')).toBe('src/utils/index.ts');
  });

  it('should remove leading ./', () => {
    expect(normalizeGitPath('./src/index.ts')).toBe('src/index.ts');
  });

  it('should remove trailing slash', () => {
    expect(normalizeGitPath('src/utils/')).toBe('src/utils');
  });

  it('should return empty string for empty input', () => {
    expect(normalizeGitPath('')).toBe('');
  });
});

describe('isSafeRefName', () => {
  it('should accept safe ref names', () => {
    expect(isSafeRefName('main')).toBe(true);
    expect(isSafeRefName('feature/branch-name')).toBe(true);
    expect(isSafeRefName('v1.0.0')).toBe(true);
  });

  it('should reject dangerous ref names', () => {
    expect(isSafeRefName('')).toBe(false);
    expect(isSafeRefName('ref; rm -rf /')).toBe(false);
    expect(isSafeRefName('ref$(cmd)')).toBe(false);
    expect(isSafeRefName('ref`cmd`')).toBe(false);
    expect(isSafeRefName('ref|pipe')).toBe(false);
  });
});
