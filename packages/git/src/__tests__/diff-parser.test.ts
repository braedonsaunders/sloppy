import { describe, it, expect } from 'vitest';
import {
  parseDiff,
  applyDiff,
  validateDiff,
  extractHunks,
  getDiffStats,
  getAffectedFiles,
} from '../diff-parser.js';

describe('parseDiff', () => {
  it('should parse simple unified diff', () => {
    const diff = `diff --git a/file.ts b/file.ts
--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,4 @@
 const a = 1;
-const b = 2;
+const b = 3;
+const c = 4;
 const d = 5;`;

    const result = parseDiff(diff);

    expect(result).toHaveLength(1);
    expect(result[0]?.oldPath).toBe('file.ts');
    expect(result[0]?.newPath).toBe('file.ts');
    expect(result[0]?.hunks).toHaveLength(1);
  });

  it('should parse diff with multiple files', () => {
    const diff = `diff --git a/file1.ts b/file1.ts
--- a/file1.ts
+++ b/file1.ts
@@ -1 +1 @@
-old
+new
diff --git a/file2.ts b/file2.ts
--- a/file2.ts
+++ b/file2.ts
@@ -1 +1 @@
-old2
+new2`;

    const result = parseDiff(diff);

    expect(result).toHaveLength(2);
    expect(result[0]?.oldPath).toBe('file1.ts');
    expect(result[1]?.oldPath).toBe('file2.ts');
  });

  it('should parse diff with multiple hunks', () => {
    const diff = `diff --git a/file.ts b/file.ts
--- a/file.ts
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

    expect(result[0]?.hunks).toHaveLength(2);
  });

  it('should handle new files', () => {
    const diff = `diff --git a/newfile.ts b/newfile.ts
new file mode 100644
--- /dev/null
+++ b/newfile.ts
@@ -0,0 +1,3 @@
+const x = 1;
+const y = 2;
+const z = 3;`;

    const result = parseDiff(diff);

    expect(result[0]?.changeType).toBe('add');
    expect(result[0]?.additions).toBe(3);
  });

  it('should handle deleted files', () => {
    const diff = `diff --git a/deleted.ts b/deleted.ts
deleted file mode 100644
--- a/deleted.ts
+++ /dev/null
@@ -1,3 +0,0 @@
-const x = 1;
-const y = 2;
-const z = 3;`;

    const result = parseDiff(diff);

    expect(result[0]?.changeType).toBe('delete');
    expect(result[0]?.deletions).toBe(3);
  });

  it('should return empty array for empty input', () => {
    expect(parseDiff('')).toEqual([]);
  });

  it('should track additions and deletions counts', () => {
    const diff = `diff --git a/file.ts b/file.ts
--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,4 @@
 const a = 1;
-const b = 2;
+const b = 3;
+const c = 4;
 const d = 5;`;

    const result = parseDiff(diff);

    expect(result[0]?.additions).toBe(2);
    expect(result[0]?.deletions).toBe(1);
  });
});

describe('extractHunks', () => {
  it('should extract all hunks from a diff', () => {
    const diff = `diff --git a/file.ts b/file.ts
--- a/file.ts
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

    const hunks = extractHunks(diff);

    expect(hunks).toHaveLength(2);
    expect(hunks[0]?.oldStart).toBe(1);
    expect(hunks[0]?.oldLines).toBe(3);
    expect(hunks[0]?.newStart).toBe(1);
    expect(hunks[0]?.newLines).toBe(3);
    expect(hunks[1]?.oldStart).toBe(10);
  });

  it('should return empty array for empty diff', () => {
    expect(extractHunks('')).toEqual([]);
  });
});

describe('getDiffStats', () => {
  it('should return correct statistics', () => {
    const diff = `diff --git a/file.ts b/file.ts
--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,4 @@
 const a = 1;
-const b = 2;
+const b = 3;
+const c = 4;
 const d = 5;`;

    const stats = getDiffStats(diff);

    expect(stats.filesChanged).toBe(1);
    expect(stats.additions).toBe(2);
    expect(stats.deletions).toBe(1);
    expect(stats.binary).toBe(0);
  });

  it('should handle multiple files', () => {
    const diff = `diff --git a/file1.ts b/file1.ts
--- a/file1.ts
+++ b/file1.ts
@@ -1 +1 @@
-old
+new
diff --git a/file2.ts b/file2.ts
--- a/file2.ts
+++ b/file2.ts
@@ -1 +1 @@
-old2
+new2`;

    const stats = getDiffStats(diff);

    expect(stats.filesChanged).toBe(2);
    expect(stats.additions).toBe(2);
    expect(stats.deletions).toBe(2);
  });
});

describe('validateDiff', () => {
  it('should validate a correct diff', () => {
    const diff = `diff --git a/file.ts b/file.ts
--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,3 @@
 line1
-old
+new
 line3`;

    expect(validateDiff(diff)).toBe(true);
  });

  it('should reject invalid input', () => {
    expect(validateDiff('')).toBe(true); // Empty diff is valid (no changes)
    expect(validateDiff('random text without diff markers')).toBe(false);
  });
});

describe('getAffectedFiles', () => {
  it('should return unique file paths', () => {
    const diff = `diff --git a/file1.ts b/file1.ts
--- a/file1.ts
+++ b/file1.ts
@@ -1 +1 @@
-old
+new
diff --git a/file2.ts b/file2.ts
--- a/file2.ts
+++ b/file2.ts
@@ -1 +1 @@
-old2
+new2`;

    const files = getAffectedFiles(diff);

    expect(files).toContain('file1.ts');
    expect(files).toContain('file2.ts');
    expect(files).toHaveLength(2);
  });
});

describe('applyDiff', () => {
  it('should apply simple replacement', () => {
    const original = `line1
line2
line3`;

    const diff = `diff --git a/test.ts b/test.ts
--- a/test.ts
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

    const diff = `diff --git a/test.ts b/test.ts
--- a/test.ts
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

    const diff = `diff --git a/test.ts b/test.ts
--- a/test.ts
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

    const diff = `diff --git a/test.ts b/test.ts
--- a/test.ts
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

    const diff = `diff --git a/test.ts b/test.ts
--- a/test.ts
+++ b/test.ts
@@ -1,3 +1,3 @@
 line1
-line2
+modified
 line3`;

    expect(() => applyDiff(original, diff)).toThrow(/mismatch/i);
  });
});
