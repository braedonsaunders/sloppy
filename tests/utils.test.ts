import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatDuration, sleep, mapRawToIssue, parseGitHubRepo } from '../src/utils';

describe('formatDuration', () => {
  it('formats zero', () => {
    assert.equal(formatDuration(0), '0s');
  });

  it('formats seconds', () => {
    assert.equal(formatDuration(45000), '45s');
  });

  it('formats minutes', () => {
    assert.equal(formatDuration(300000), '5m');
  });

  it('formats minutes and seconds', () => {
    assert.equal(formatDuration(330000), '5m30s');
  });

  it('formats hours', () => {
    assert.equal(formatDuration(7200000), '2h');
  });

  it('formats hours and minutes', () => {
    assert.equal(formatDuration(8100000), '2h15m');
  });
});

describe('sleep', () => {
  it('resolves after delay', async () => {
    const start = Date.now();
    await sleep(50);
    const elapsed = Date.now() - start;
    assert.ok(elapsed >= 40, `Expected >= 40ms, got ${elapsed}ms`);
  });
});

describe('mapRawToIssue', () => {
  it('maps a valid raw object', () => {
    const raw = { type: 'bugs', severity: 'high', file: 'src/foo.ts', line: 42, description: 'Null deref' };
    const issue = mapRawToIssue(raw, 'test', 0);
    assert.ok(issue);
    assert.equal(issue.type, 'bugs');
    assert.equal(issue.severity, 'high');
    assert.equal(issue.file, 'src/foo.ts');
    assert.equal(issue.line, 42);
    assert.equal(issue.description, 'Null deref');
    assert.equal(issue.status, 'found');
    assert.ok(issue.id.startsWith('test-'));
  });

  it('returns null for null input', () => {
    assert.equal(mapRawToIssue(null, 'test', 0), null);
  });

  it('returns null for non-object', () => {
    assert.equal(mapRawToIssue('string', 'test', 0), null);
  });

  it('defaults type to lint for invalid type', () => {
    const raw = { file: 'a.ts', type: 'invalid', severity: 'low', description: 'x' };
    const issue = mapRawToIssue(raw, 'test', 0);
    assert.ok(issue);
    assert.equal(issue.type, 'lint');
  });

  it('defaults severity to medium for invalid severity', () => {
    const raw = { file: 'a.ts', type: 'bugs', severity: 'mega', description: 'x' };
    const issue = mapRawToIssue(raw, 'test', 0);
    assert.ok(issue);
    assert.equal(issue.severity, 'medium');
  });

  it('defaults file to unknown when missing', () => {
    const raw = { type: 'bugs', severity: 'low', description: 'x' };
    const issue = mapRawToIssue(raw, 'test', 0);
    assert.ok(issue);
    assert.equal(issue.file, 'unknown');
  });

  it('defaults description when missing', () => {
    const raw = { file: 'a.ts' };
    const issue = mapRawToIssue(raw, 'test', 0);
    assert.ok(issue);
    assert.equal(issue.description, 'Unknown issue');
  });
});

describe('parseGitHubRepo', () => {
  const origRepo = process.env.GITHUB_REPOSITORY;

  it('parses valid owner/repo', () => {
    process.env.GITHUB_REPOSITORY = 'octocat/hello-world';
    const result = parseGitHubRepo();
    assert.deepEqual(result, { owner: 'octocat', repo: 'hello-world' });
  });

  it('returns null for empty string', () => {
    process.env.GITHUB_REPOSITORY = '';
    assert.equal(parseGitHubRepo(), null);
  });

  it('returns null for no slash', () => {
    process.env.GITHUB_REPOSITORY = 'just-a-name';
    assert.equal(parseGitHubRepo(), null);
  });

  it('returns null for trailing slash', () => {
    process.env.GITHUB_REPOSITORY = 'owner/';
    assert.equal(parseGitHubRepo(), null);
  });

  it('returns null for leading slash', () => {
    process.env.GITHUB_REPOSITORY = '/repo';
    assert.equal(parseGitHubRepo(), null);
  });

  // Restore
  it('cleanup', () => {
    if (origRepo !== undefined) process.env.GITHUB_REPOSITORY = origRepo;
    else delete process.env.GITHUB_REPOSITORY;
  });
});
