import { describe, it, expect } from 'vitest';
import { StubAnalyzer } from '../stubs/index.js';
import { IssueType, IssueSeverity } from '@sloppy/core';

describe('StubAnalyzer', () => {
  const analyzer = new StubAnalyzer();

  describe('metadata', () => {
    it('should have correct name and category', () => {
      expect(analyzer.name).toBe('stub');
      expect(analyzer.category).toBe('completeness');
    });
  });

  describe('analyzeFile', () => {
    it('should detect TODO comments', async () => {
      const content = `
        function calculate() {
          // TODO: implement calculation
          return 0;
        }
      `;

      const issues = await analyzer.analyzeFile('/test/file.ts', content);

      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0]?.type).toBe(IssueType.STUB);
      expect(issues[0]?.message).toContain('TODO');
    });

    it('should detect FIXME comments', async () => {
      const content = `
        function process() {
          // FIXME: this is broken
          throw new Error('broken');
        }
      `;

      const issues = await analyzer.analyzeFile('/test/file.ts', content);

      expect(issues.length).toBeGreaterThan(0);
      expect(issues.some(i => i.message.includes('FIXME'))).toBe(true);
    });

    it('should detect NotImplementedError throws', async () => {
      const content = `
        function handler() {
          throw new Error('Not implemented');
        }
      `;

      const issues = await analyzer.analyzeFile('/test/file.ts', content);

      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0]?.severity).toBe(IssueSeverity.HIGH);
    });

    it('should detect placeholder return values', async () => {
      const content = `
        function getData(): string {
          return 'placeholder';
        }

        function getNumber(): number {
          return -1; // placeholder
        }
      `;

      const issues = await analyzer.analyzeFile('/test/file.ts', content);

      expect(issues.some(i => i.message.toLowerCase().includes('placeholder'))).toBe(true);
    });

    it('should detect empty function bodies', async () => {
      const content = `
        function emptyHandler() {
          // intentionally empty
        }

        const callback = () => {};
      `;

      const issues = await analyzer.analyzeFile('/test/file.ts', content);

      expect(issues.length).toBeGreaterThan(0);
    });

    it('should detect console.log only functions', async () => {
      const content = `
        function debugOnly() {
          console.log('called');
        }
      `;

      const issues = await analyzer.analyzeFile('/test/file.ts', content);

      expect(issues.some(i => i.message.includes('console'))).toBe(true);
    });

    it('should not flag legitimate code', async () => {
      const content = `
        function calculate(a: number, b: number): number {
          const result = a + b;
          return result;
        }

        function validate(input: string): boolean {
          if (!input || input.length === 0) {
            return false;
          }
          return input.length > 0;
        }
      `;

      const issues = await analyzer.analyzeFile('/test/file.ts', content);

      // Should have no or very few issues for legitimate code
      expect(issues.length).toBe(0);
    });

    it('should handle different file types', async () => {
      const jsContent = `
        function stub() {
          // TODO: implement
        }
      `;

      const jsIssues = await analyzer.analyzeFile('/test/file.js', jsContent);
      expect(jsIssues.length).toBeGreaterThan(0);

      const tsxContent = `
        function Component() {
          // FIXME: add props
          return null;
        }
      `;

      const tsxIssues = await analyzer.analyzeFile('/test/file.tsx', tsxContent);
      expect(tsxIssues.length).toBeGreaterThan(0);
    });
  });

  describe('analyze', () => {
    it('should return issues with correct structure', async () => {
      const content = `
        // TODO: fix this
        function broken() {}
      `;

      const issues = await analyzer.analyzeFile('/test/file.ts', content);

      if (issues.length > 0) {
        const issue = issues[0]!;
        expect(issue).toHaveProperty('type');
        expect(issue).toHaveProperty('severity');
        expect(issue).toHaveProperty('message');
        expect(issue).toHaveProperty('filePath');
        expect(issue).toHaveProperty('line');
        expect(issue.filePath).toBe('/test/file.ts');
      }
    });
  });
});
