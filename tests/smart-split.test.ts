import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { estimateTokens, compressFile, calculateCodeBudget, getModelInputLimit } from '../src/smart-split';

describe('estimateTokens', () => {
  it('estimates tokens from text length', () => {
    // 320 chars / 3.2 chars per token = 100 tokens
    const text = 'a'.repeat(320);
    assert.equal(estimateTokens(text), 100);
  });

  it('handles empty string', () => {
    assert.equal(estimateTokens(''), 0);
  });

  it('rounds up', () => {
    assert.equal(estimateTokens('abc'), 1); // 3 / 3.2 = 0.9375 -> ceil -> 1
  });
});

describe('getModelInputLimit', () => {
  it('returns known model limit', () => {
    assert.equal(getModelInputLimit('openai/gpt-4o-mini'), 8000);
  });

  it('returns default for unknown model', () => {
    assert.equal(getModelInputLimit('unknown-model'), 8000);
  });
});

describe('calculateCodeBudget', () => {
  it('subtracts overhead from model limit', () => {
    const budget = calculateCodeBudget(8000);
    // (8000 - 500) * 3.2 = 24000
    assert.equal(budget, 24000);
  });

  it('has a floor of 1000 tokens', () => {
    const budget = calculateCodeBudget(100);
    // max(100 - 500, 1000) = 1000, 1000 * 3.2 = 3200
    assert.equal(budget, 3200);
  });
});

describe('compressFile', () => {
  it('returns original if under budget', () => {
    const { content, compressed } = compressFile('const x = 1;', '.ts', 1000);
    assert.equal(content, 'const x = 1;');
    assert.equal(compressed, false);
  });

  it('strips comments when over budget', () => {
    const code = '// This is a long comment\nconst x = 1;\n/* block */\nconst y = 2;';
    const { content, compressed } = compressFile(code, '.ts', 30);
    assert.equal(compressed, true);
    assert.ok(!content.includes('// This is a long comment'));
    assert.ok(!content.includes('/* block */'));
  });

  it('hard truncates when all else fails', () => {
    const code = 'x'.repeat(10000);
    const { content, compressed } = compressFile(code, '.ts', 200);
    assert.equal(compressed, true);
    assert.ok(content.length <= 200);
    assert.ok(content.includes('truncated'));
  });
});
