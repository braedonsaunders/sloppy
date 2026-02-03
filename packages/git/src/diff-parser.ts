/**
 * Diff parsing utilities for @sloppy/git
 */

import { DiffFile, DiffHunk, DiffLine } from './types';

/**
 * Parses a unified diff string into structured DiffFile objects
 * @param diffString - The raw diff output from git
 * @returns Array of parsed DiffFile objects
 */
export function parseDiff(diffString: string): DiffFile[] {
  if (!diffString || typeof diffString !== 'string') {
    return [];
  }

  const files: DiffFile[] = [];
  const lines = diffString.split('\n');

  let currentFile: DiffFile | null = null;
  let currentHunk: DiffHunk | null = null;
  let oldLineNum = 0;
  let newLineNum = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Match diff header: diff --git a/path b/path
    const diffHeaderMatch = line.match(/^diff --git a\/(.+) b\/(.+)$/);
    if (diffHeaderMatch) {
      // Save previous file if exists
      if (currentFile) {
        if (currentHunk) {
          currentFile.hunks.push(currentHunk);
        }
        files.push(currentFile);
      }

      currentFile = {
        oldPath: diffHeaderMatch[1],
        newPath: diffHeaderMatch[2],
        changeType: 'modify',
        isBinary: false,
        hunks: [],
        additions: 0,
        deletions: 0,
      };
      currentHunk = null;
      continue;
    }

    if (!currentFile) {
      continue;
    }

    // Detect new file
    if (line.startsWith('new file mode')) {
      currentFile.changeType = 'add';
      continue;
    }

    // Detect deleted file
    if (line.startsWith('deleted file mode')) {
      currentFile.changeType = 'delete';
      continue;
    }

    // Detect renamed file
    if (line.startsWith('rename from ')) {
      currentFile.changeType = 'rename';
      currentFile.oldPath = line.substring(12);
      continue;
    }
    if (line.startsWith('rename to ')) {
      currentFile.newPath = line.substring(10);
      continue;
    }

    // Detect copied file
    if (line.startsWith('copy from ')) {
      currentFile.changeType = 'copy';
      currentFile.oldPath = line.substring(10);
      continue;
    }
    if (line.startsWith('copy to ')) {
      currentFile.newPath = line.substring(8);
      continue;
    }

    // Detect binary file
    if (line.startsWith('Binary files') || line.includes('GIT binary patch')) {
      currentFile.isBinary = true;
      continue;
    }

    // Match hunk header: @@ -oldStart,oldLines +newStart,newLines @@ optional context
    const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/);
    if (hunkMatch) {
      // Save previous hunk if exists
      if (currentHunk) {
        currentFile.hunks.push(currentHunk);
      }

      oldLineNum = parseInt(hunkMatch[1], 10);
      newLineNum = parseInt(hunkMatch[3], 10);

      currentHunk = {
        oldStart: oldLineNum,
        oldLines: parseInt(hunkMatch[2] || '1', 10),
        newStart: newLineNum,
        newLines: parseInt(hunkMatch[4] || '1', 10),
        header: line,
        lines: [],
      };
      continue;
    }

    // Process hunk lines
    if (currentHunk) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        currentHunk.lines.push({
          type: 'add',
          content: line.substring(1),
          oldLineNumber: null,
          newLineNumber: newLineNum,
        });
        currentFile.additions++;
        newLineNum++;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        currentHunk.lines.push({
          type: 'remove',
          content: line.substring(1),
          oldLineNumber: oldLineNum,
          newLineNumber: null,
        });
        currentFile.deletions++;
        oldLineNum++;
      } else if (line.startsWith(' ')) {
        currentHunk.lines.push({
          type: 'context',
          content: line.substring(1),
          oldLineNumber: oldLineNum,
          newLineNumber: newLineNum,
        });
        oldLineNum++;
        newLineNum++;
      } else if (line === '\\ No newline at end of file') {
        // Handle no newline marker - attach to previous line as metadata
        continue;
      }
    }
  }

  // Don't forget the last file and hunk
  if (currentFile) {
    if (currentHunk) {
      currentFile.hunks.push(currentHunk);
    }
    files.push(currentFile);
  }

  return files;
}

/**
 * Applies a diff to content (simple patch application)
 * Note: This is a simplified implementation that works for clean patches.
 * For complex merges, use git's native apply command.
 *
 * @param content - The original file content
 * @param diff - The diff to apply (for a single file)
 * @returns The patched content
 */
export function applyDiff(content: string, diff: string): string {
  const files = parseDiff(diff);

  if (files.length === 0) {
    return content;
  }

  // Use the first file's hunks
  const file = files[0];

  if (file.isBinary) {
    throw new Error('Cannot apply diff to binary file');
  }

  const lines = content.split('\n');
  const result: string[] = [];
  let lineIndex = 0;

  for (const hunk of file.hunks) {
    // Copy lines before the hunk
    while (lineIndex < hunk.oldStart - 1) {
      result.push(lines[lineIndex]);
      lineIndex++;
    }

    // Apply hunk changes
    for (const diffLine of hunk.lines) {
      switch (diffLine.type) {
        case 'context':
          // Verify context matches
          if (lines[lineIndex] !== diffLine.content) {
            throw new Error(
              `Context mismatch at line ${lineIndex + 1}: ` +
              `expected "${diffLine.content}", got "${lines[lineIndex]}"`
            );
          }
          result.push(lines[lineIndex]);
          lineIndex++;
          break;
        case 'remove':
          // Verify removed line matches
          if (lines[lineIndex] !== diffLine.content) {
            throw new Error(
              `Remove mismatch at line ${lineIndex + 1}: ` +
              `expected "${diffLine.content}", got "${lines[lineIndex]}"`
            );
          }
          lineIndex++;
          break;
        case 'add':
          result.push(diffLine.content);
          break;
      }
    }
  }

  // Copy remaining lines
  while (lineIndex < lines.length) {
    result.push(lines[lineIndex]);
    lineIndex++;
  }

  return result.join('\n');
}

/**
 * Validates a diff string for basic correctness
 * @param diff - The diff string to validate
 * @returns True if the diff appears valid
 */
export function validateDiff(diff: string): boolean {
  if (!diff || typeof diff !== 'string') {
    return false;
  }

  const trimmed = diff.trim();

  // Empty diff is technically valid (no changes)
  if (!trimmed) {
    return true;
  }

  // Must start with diff --git or contain hunk headers
  if (!trimmed.startsWith('diff --git') && !trimmed.includes('@@')) {
    return false;
  }

  // Parse and check for errors
  try {
    const files = parseDiff(diff);

    // Validate hunk line counts
    for (const file of files) {
      for (const hunk of file.hunks) {
        let actualOldLines = 0;
        let actualNewLines = 0;

        for (const line of hunk.lines) {
          if (line.type === 'context') {
            actualOldLines++;
            actualNewLines++;
          } else if (line.type === 'remove') {
            actualOldLines++;
          } else if (line.type === 'add') {
            actualNewLines++;
          }
        }

        // Allow some tolerance for edge cases
        if (Math.abs(actualOldLines - hunk.oldLines) > 1 ||
            Math.abs(actualNewLines - hunk.newLines) > 1) {
          return false;
        }
      }
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Extracts all hunks from a diff string
 * @param diff - The diff string
 * @returns Array of DiffHunk objects
 */
export function extractHunks(diff: string): DiffHunk[] {
  const files = parseDiff(diff);
  const hunks: DiffHunk[] = [];

  for (const file of files) {
    hunks.push(...file.hunks);
  }

  return hunks;
}

/**
 * Gets statistics about a diff
 * @param diff - The diff string
 * @returns Statistics object with additions, deletions, and file counts
 */
export function getDiffStats(diff: string): {
  filesChanged: number;
  additions: number;
  deletions: number;
  binary: number;
} {
  const files = parseDiff(diff);

  return {
    filesChanged: files.length,
    additions: files.reduce((sum, f) => sum + f.additions, 0),
    deletions: files.reduce((sum, f) => sum + f.deletions, 0),
    binary: files.filter(f => f.isBinary).length,
  };
}

/**
 * Formats a DiffFile back into unified diff format
 * @param file - The DiffFile to format
 * @returns Unified diff string
 */
export function formatDiff(file: DiffFile): string {
  const lines: string[] = [];

  // Header
  lines.push(`diff --git a/${file.oldPath} b/${file.newPath}`);

  if (file.changeType === 'add') {
    lines.push('new file mode 100644');
  } else if (file.changeType === 'delete') {
    lines.push('deleted file mode 100644');
  } else if (file.changeType === 'rename') {
    lines.push(`rename from ${file.oldPath}`);
    lines.push(`rename to ${file.newPath}`);
  }

  if (file.isBinary) {
    lines.push('Binary files differ');
    return lines.join('\n');
  }

  lines.push(`--- a/${file.oldPath}`);
  lines.push(`+++ b/${file.newPath}`);

  for (const hunk of file.hunks) {
    lines.push(hunk.header);

    for (const diffLine of hunk.lines) {
      switch (diffLine.type) {
        case 'add':
          lines.push(`+${diffLine.content}`);
          break;
        case 'remove':
          lines.push(`-${diffLine.content}`);
          break;
        case 'context':
          lines.push(` ${diffLine.content}`);
          break;
      }
    }
  }

  return lines.join('\n');
}

/**
 * Inverts a diff (swaps additions and deletions)
 * Useful for creating reverse patches
 * @param diff - The diff to invert
 * @returns Inverted diff string
 */
export function invertDiff(diff: string): string {
  const files = parseDiff(diff);

  const invertedFiles = files.map(file => ({
    ...file,
    oldPath: file.newPath,
    newPath: file.oldPath,
    changeType: file.changeType === 'add' ? 'delete' as const :
                file.changeType === 'delete' ? 'add' as const :
                file.changeType,
    additions: file.deletions,
    deletions: file.additions,
    hunks: file.hunks.map(hunk => ({
      ...hunk,
      oldStart: hunk.newStart,
      oldLines: hunk.newLines,
      newStart: hunk.oldStart,
      newLines: hunk.oldLines,
      lines: hunk.lines.map(line => ({
        ...line,
        type: line.type === 'add' ? 'remove' as const :
              line.type === 'remove' ? 'add' as const :
              line.type,
        oldLineNumber: line.newLineNumber,
        newLineNumber: line.oldLineNumber,
      })),
    })),
  }));

  return invertedFiles.map(formatDiff).join('\n');
}

/**
 * Extracts the file paths affected by a diff
 * @param diff - The diff string
 * @returns Array of unique file paths
 */
export function getAffectedFiles(diff: string): string[] {
  const files = parseDiff(diff);
  const paths = new Set<string>();

  for (const file of files) {
    if (file.oldPath !== '/dev/null') {
      paths.add(file.oldPath);
    }
    if (file.newPath !== '/dev/null') {
      paths.add(file.newPath);
    }
  }

  return Array.from(paths);
}
