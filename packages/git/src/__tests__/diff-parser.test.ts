import { describe, it, expect } from 'vitest';
import {
  parseDiff,
  parseUnifiedDiff,
  createUnifiedDiff,
  applyDiff,
  DiffHunk,
} from '../diff-parser.js';

describe('parseDiff', () => {
  it('should parse simple unified diff', () => {
    const diff = `--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,4 @@
 const a = 1;
-const b = 2;
+const b = 3;
+const c = 4;
 const d = 5;`;

    const result = parseDiff(diff);

    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.oldPath).toBe('a/file.ts');
    expect(result.files[0]?.newPath).toBe('b/file.ts');
    expect(result.files[0]?.hunks).toHaveLength(1);
  });

  it('should parse diff with multiple files', () => {
    const diff = `--- a/file1.ts
+++ b/file1.ts
@@ -1 +1 @@
-old
+new
--- a/file2.ts
+++ b/file2.ts
@@ -1 +1 @@
-old2
+new2`;

    const result = parseDiff(diff);

    expect(result.files).toHaveLength(2);
    expect(result.files[0]?.oldPath).toBe('a/file1.ts');
    expect(result.files[1]?.oldPath).toBe('a/file2.ts');
  });

  it('should parse diff with multiple hunks', () => {
    const diff = `--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,3 @@
 line1
-old1
+new1
 line3
@@ -10,3 +10,3 @@
 line10
-old2
+new2
 line12`;

    const result = parseDiff(diff);

    expect(result.files[0]?.hunks).toHaveLength(2);
  });

  it('should handle new files', () => {
    const diff = `--- /dev/null
+++ b/newfile.ts
@@ -0,0 +1,3 @@
+const x = 1;
+const y = 2;
+const z = 3;`;

    const result = parseDiff(diff);

    expect(result.files[0]?.oldPath).toBe('/dev/null');
    expect(result.files[0]?.newPath).toBe('b/newfile.ts');
    expect(result.files[0]?.isNew).toBe(true);
  });

  it('should handle deleted files', () => {
    const diff = `--- a/deleted.ts
+++ /dev/null
@@ -1,3 +0,0 @@
-const x = 1;
-const y = 2;
-const z = 3;`;

    const result = parseDiff(diff);

    expect(result.files[0]?.newPath).toBe('/dev/null');
    expect(result.files[0]?.isDeleted).toBe(true);
  });
});

describe('parseUnifiedDiff', () => {
  it('should parse hunk header', () => {
    const hunkLine = '@@ -10,5 +12,7 @@';
    const hunk = parseUnifiedDiff(hunkLine);

    expect(hunk.oldStart).toBe(10);
    expect(hunk.oldCount).toBe(5);
    expect(hunk.newStart).toBe(12);
    expect(hunk.newCount).toBe(7);
  });

  it('should parse hunk header with context', () => {
    const hunkLine = '@@ -10,5 +12,7 @@ function test()';
    const hunk = parseUnifiedDiff(hunkLine);

    expect(hunk.context).toBe('function test()');
  });

  it('should parse single line hunk', () => {
    const hunkLine = '@@ -1 +1 @@';
    const hunk = parseUnifiedDiff(hunkLine);

    expect(hunk.oldStart).toBe(1);
    expect(hunk.oldCount).toBe(1);
    expect(hunk.newStart).toBe(1);
    expect(hunk.newCount).toBe(1);
  });
});

describe('createUnifiedDiff', () => {
  it('should create valid unified diff', () => {
    const oldContent = `line1
line2
line3`;
    const newContent = `line1
modified
line3`;

    const diff = createUnifiedDiff('test.ts', oldContent, newContent);

    expect(diff).toContain('--- a/test.ts');
    expect(diff).toContain('+++ b/test.ts');
    expect(diff).toContain('-line2');
    expect(diff).toContain('+modified');
  });

  it('should handle addition only', () => {
    const oldContent = `line1
line2`;
    const newContent = `line1
line2
line3`;

    const diff = createUnifiedDiff('test.ts', oldContent, newContent);

    expect(diff).toContain('+line3');
    expect(diff).not.toContain('-line');
  });

  it('should handle deletion only', () => {
    const oldContent = `line1
line2
line3`;
    const newContent = `line1
line3`;

    const diff = createUnifiedDiff('test.ts', oldContent, newContent);

    expect(diff).toContain('-line2');
  });

  it('should handle empty old content (new file)', () => {
    const oldContent = '';
    const newContent = `line1
line2`;

    const diff = createUnifiedDiff('test.ts', oldContent, newContent);

    expect(diff).toContain('+line1');
    expect(diff).toContain('+line2');
  });
});

describe('applyDiff', () => {
  it('should apply simple replacement', () => {
    const original = `line1
line2
line3`;

    const diff = `--- a/test.ts
+++ b/test.ts
@@ -1,3 +1,3 @@
 line1
-line2
+modified
 line3`;

    const result = applyDiff(original, diff);

    expect(result).toBe(`line1
modified
line3`);
  });

  it('should apply addition', () => {
    const original = `line1
line2`;

    const diff = `--- a/test.ts
+++ b/test.ts
@@ -1,2 +1,3 @@
 line1
 line2
+line3`;

    const result = applyDiff(original, diff);

    expect(result).toContain('line3');
  });

  it('should apply deletion', () => {
    const original = `line1
line2
line3`;

    const diff = `--- a/test.ts
+++ b/test.ts
@@ -1,3 +1,2 @@
 line1
-line2
 line3`;

    const result = applyDiff(original, diff);

    expect(result).not.toContain('line2');
    expect(result).toBe(`line1
line3`);
  });

  it('should apply multiple hunks', () => {
    const original = `line1
line2
line3
line4
line5
line6
line7`;

    const diff = `--- a/test.ts
+++ b/test.ts
@@ -1,3 +1,3 @@
 line1
-line2
+modified2
 line3
@@ -5,3 +5,3 @@
 line5
-line6
+modified6
 line7`;

    const result = applyDiff(original, diff);

    expect(result).toContain('modified2');
    expect(result).toContain('modified6');
    expect(result).not.toContain('line2');
    expect(result).not.toContain('line6');
  });

  it('should throw on context mismatch', () => {
    const original = `different
content
here`;

    const diff = `--- a/test.ts
+++ b/test.ts
@@ -1,3 +1,3 @@
 line1
-line2
+modified
 line3`;

    expect(() => applyDiff(original, diff)).toThrow(/context/i);
  });
});
