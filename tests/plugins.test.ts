import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSimpleYaml, applyFilters } from '../src/plugins';
import { Issue } from '../src/types';

describe('parseSimpleYaml', () => {
  it('parses simple key-value pairs', () => {
    const result = parseSimpleYaml('name: my-plugin\nversion: 1.0');
    assert.equal(result.name, 'my-plugin');
    assert.equal(result.version, '1.0');
  });

  it('parses lists', () => {
    const result = parseSimpleYaml('items:\n  - alpha\n  - beta\n  - gamma');
    assert.deepEqual(result.items, ['alpha', 'beta', 'gamma']);
  });

  it('skips comments', () => {
    const result = parseSimpleYaml('# This is a comment\nname: test');
    assert.equal(result.name, 'test');
    assert.equal(Object.keys(result).length, 1);
  });

  it('handles multiline block scalar', () => {
    const result = parseSimpleYaml('prompt: |\n  line one\n  line two\nname: test');
    assert.equal(result.prompt, 'line one\nline two');
    assert.equal(result.name, 'test');
  });

  it('strips quotes from values', () => {
    const result = parseSimpleYaml("name: 'quoted'\ndesc: \"double\"");
    assert.equal(result.name, 'quoted');
    assert.equal(result.desc, 'double');
  });

  it('parses nested maps', () => {
    const result = parseSimpleYaml('hooks:\n  pre-scan: ./run.sh\n  post-scan: ./done.sh');
    const hooks = result.hooks as Record<string, string>;
    assert.equal(hooks['pre-scan'], './run.sh');
    assert.equal(hooks['post-scan'], './done.sh');
  });

  it('handles empty input', () => {
    const result = parseSimpleYaml('');
    assert.deepEqual(result, {});
  });
});

describe('applyFilters', () => {
  const makeIssue = (overrides: Partial<Issue>): Issue => ({
    id: 'test-1',
    type: 'bugs',
    severity: 'medium',
    file: 'src/foo.ts',
    description: 'Test issue',
    status: 'found',
    ...overrides,
  });

  it('returns all issues with empty filters', () => {
    const issues = [makeIssue({})];
    assert.equal(applyFilters(issues, {}).length, 1);
  });

  it('excludes by type', () => {
    const issues = [
      makeIssue({ type: 'lint' }),
      makeIssue({ type: 'bugs' }),
    ];
    const result = applyFilters(issues, { 'exclude-types': ['lint'] });
    assert.equal(result.length, 1);
    assert.equal(result[0].type, 'bugs');
  });

  it('filters by min severity', () => {
    const issues = [
      makeIssue({ severity: 'low' }),
      makeIssue({ severity: 'high' }),
      makeIssue({ severity: 'critical' }),
    ];
    const result = applyFilters(issues, { 'min-severity': 'high' });
    assert.equal(result.length, 2);
  });

  it('excludes by path glob', () => {
    const issues = [
      makeIssue({ file: 'src/foo.ts' }),
      makeIssue({ file: 'tests/bar.ts' }),
    ];
    const result = applyFilters(issues, { 'exclude-paths': ['tests/**'] });
    assert.equal(result.length, 1);
    assert.equal(result[0].file, 'src/foo.ts');
  });
});
