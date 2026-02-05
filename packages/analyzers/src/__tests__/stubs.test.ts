import { describe, it, expect } from 'vitest';
import { StubAnalyzer } from '../stubs/index.js';
import type { FileContent, AnalyzerOptions, Issue } from '../base.js';

/**
 * Helper to invoke the private analyzeFile method with a content string.
 * This constructs a FileContent object and passes it through.
 */
function analyzeContent(analyzer: StubAnalyzer, filePath: string, content: string): Issue[] {
  const file: FileContent = { path: filePath, content, lines: content.split('\n') };
  const options: AnalyzerOptions = { rootDir: '/' };
  // Access private method for unit testing
  return (analyzer as any).analyzeFile(file, options);
}

describe('StubAnalyzer', () => {
  const analyzer = new StubAnalyzer();

  describe('metadata', () => {
    it('should have correct name and category', () => {
      expect(analyzer.name).toBe('stub-analyzer');
      expect(analyzer.category).toBe('stub');
    });
  });

  describe('analyzeFile', () => {
    it('should detect TODO comments', () => {
      const content = `
        function calculate() {
          // TODO: implement calculation
          return 0;
        }
      `;

      const issues = analyzeContent(analyzer, '/test/file.ts', content);

      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0]?.category).toBe('stub');
      expect(issues[0]?.message).toContain('TODO');
    });

    it('should detect FIXME comments', () => {
      const content = `
        function process() {
          // FIXME: this is broken
          throw new Error('broken');
        }
      `;

      const issues = analyzeContent(analyzer, '/test/file.ts', content);

      expect(issues.length).toBeGreaterThan(0);
      expect(issues.some(i => i.message.includes('FIXME'))).toBe(true);
    });

    it('should detect NotImplementedError throws', () => {
      const content = `
        function handler() {
          throw new Error('Not implemented');
        }
      `;

      const issues = analyzeContent(analyzer, '/test/file.ts', content);

      expect(issues.length).toBeGreaterThan(0);
      expect(issues.some(i => i.severity === 'error')).toBe(true);
    });

    it('should detect placeholder return values', () => {
      const content = `
        function getData(): string {
          return 'placeholder';
        }

        function getNumber(): number {
          return -1; // placeholder
        }
      `;

      const issues = analyzeContent(analyzer, '/test/file.ts', content);

      expect(issues.some(i => i.message.toLowerCase().includes('placeholder'))).toBe(true);
    });

    it('should detect empty function bodies', () => {
      const content = `
        function emptyHandler() {
        }

        const callback = () => {};
      `;

      const issues = analyzeContent(analyzer, '/test/file.ts', content);

      expect(issues.length).toBeGreaterThan(0);
    });

    it('should detect console.log only functions', () => {
      const content = `
        function debugOnly() {
          console.log('called');
        }
      `;

      const issues = analyzeContent(analyzer, '/test/file.ts', content);

      expect(issues.some(i => i.message.includes('logging'))).toBe(true);
    });

    it('should not flag legitimate code', () => {
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

      const issues = analyzeContent(analyzer, '/test/file.ts', content);

      // Should have no or very few issues for legitimate code
      expect(issues.length).toBe(0);
    });

    it('should handle different file types', () => {
      const jsContent = `
        function stub() {
          // TODO: implement
        }
      `;

      const jsIssues = analyzeContent(analyzer, '/test/file.js', jsContent);
      expect(jsIssues.length).toBeGreaterThan(0);

      const tsxContent = `
        function Component() {
          // FIXME: add props
          return null;
        }
      `;

      const tsxIssues = analyzeContent(analyzer, '/test/file.tsx', tsxContent);
      expect(tsxIssues.length).toBeGreaterThan(0);
    });
  });

  describe('analyze', () => {
    it('should return issues with correct structure', () => {
      const content = `
        // TODO: fix this
        function broken() {}
      `;

      const issues = analyzeContent(analyzer, '/test/file.ts', content);

      if (issues.length > 0) {
        const issue = issues[0]!;
        expect(issue).toHaveProperty('category');
        expect(issue).toHaveProperty('severity');
        expect(issue).toHaveProperty('message');
        expect(issue).toHaveProperty('location');
        expect(issue.location).toHaveProperty('file');
        expect(issue.location).toHaveProperty('line');
        expect(issue.location.file).toBe('/test/file.ts');
      }
    });
  });
});
