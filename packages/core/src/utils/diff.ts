/**
 * Diff Utility
 *
 * Functions for working with unified diffs - parsing, applying, and formatting.
 * Used to handle code changes proposed by AI providers.
 */

/**
 * Represents a single hunk in a diff.
 */
export interface DiffHunk {
  /**
   * Starting line number in the original file.
   */
  oldStart: number;

  /**
   * Number of lines in the original file.
   */
  oldLines: number;

  /**
   * Starting line number in the new file.
   */
  newStart: number;

  /**
   * Number of lines in the new file.
   */
  newLines: number;

  /**
   * Lines in this hunk with their change type.
   */
  lines: DiffLine[];

  /**
   * Optional hunk header context (e.g., function name).
   */
  header?: string;
}

/**
 * Represents a single line in a diff.
 */
export interface DiffLine {
  /**
   * Type of change for this line.
   */
  type: 'context' | 'add' | 'remove';

  /**
   * The line content (without the +/- prefix).
   */
  content: string;

  /**
   * Line number in the original file (for context and remove).
   */
  oldLineNumber?: number;

  /**
   * Line number in the new file (for context and add).
   */
  newLineNumber?: number;
}

/**
 * Represents a parsed diff for a single file.
 */
export interface FileDiff {
  /**
   * Path to the original file.
   */
  oldPath: string;

  /**
   * Path to the new file.
   */
  newPath: string;

  /**
   * Type of change.
   */
  changeType: 'added' | 'deleted' | 'modified' | 'renamed';

  /**
   * Hunks containing the actual changes.
   */
  hunks: DiffHunk[];

  /**
   * Whether this is a binary file.
   */
  isBinary: boolean;

  /**
   * File mode changes (if any).
   */
  oldMode?: string;
  newMode?: string;
}

/**
 * Represents a complete parsed diff (may contain multiple files).
 */
export interface ParsedDiff {
  /**
   * Individual file diffs.
   */
  files: FileDiff[];

  /**
   * Total lines added across all files.
   */
  totalAdded: number;

  /**
   * Total lines removed across all files.
   */
  totalRemoved: number;
}

/**
 * Result of applying a diff.
 */
export interface ApplyResult {
  /**
   * Whether the diff was applied successfully.
   */
  success: boolean;

  /**
   * The resulting content after applying the diff.
   */
  content?: string;

  /**
   * Error message if application failed.
   */
  error?: string;

  /**
   * Hunks that failed to apply (for partial application).
   */
  failedHunks?: number[];
}

/**
 * Options for diff formatting.
 */
export interface FormatOptions {
  /**
   * Number of context lines to include.
   * @default 3
   */
  context?: number;

  /**
   * Whether to include file headers.
   * @default true
   */
  includeHeaders?: boolean;

  /**
   * Whether to include timestamps in headers.
   * @default false
   */
  includeTimestamps?: boolean;

  /**
   * Whether to colorize the output.
   * @default false
   */
  colorize?: boolean;
}

/**
 * ANSI color codes for colorized diff output.
 */
const COLORS = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
} as const;

/**
 * Parse a unified diff string into structured format.
 *
 * @param diffText - The unified diff text
 * @returns Parsed diff structure
 */
export function parseDiff(diffText: string): ParsedDiff {
  const files: FileDiff[] = [];
  let totalAdded = 0;
  let totalRemoved = 0;

  // Split into file sections
  const filePattern =
    /^diff --git a\/(.+) b\/(.+)$/gm;
  const sections = diffText.split(filePattern);

  // Process each file section (skip first empty section)
  for (let i = 1; i < sections.length; i += 3) {
    const oldPath = sections[i];
    const newPath = sections[i + 1];
    const content = sections[i + 2];

    if (!oldPath || !newPath || !content) {
      continue;
    }

    const fileDiff = parseFileDiff(oldPath, newPath, content);
    files.push(fileDiff);

    // Count additions and removals
    for (const hunk of fileDiff.hunks) {
      for (const line of hunk.lines) {
        if (line.type === 'add') totalAdded++;
        if (line.type === 'remove') totalRemoved++;
      }
    }
  }

  return { files, totalAdded, totalRemoved };
}

/**
 * Parse a single file's diff content.
 *
 * @param oldPath - Original file path
 * @param newPath - New file path
 * @param content - Diff content for this file
 * @returns Parsed file diff
 */
function parseFileDiff(
  oldPath: string,
  newPath: string,
  content: string
): FileDiff {
  const hunks: DiffHunk[] = [];
  let changeType: FileDiff['changeType'] = 'modified';
  let isBinary = false;
  let oldMode: string | undefined;
  let newMode: string | undefined;

  // Check for binary file
  if (content.includes('Binary files')) {
    isBinary = true;
  }

  // Check for mode changes
  const oldModeMatch = content.match(/^old mode (\d+)/m);
  const newModeMatch = content.match(/^new mode (\d+)/m);
  if (oldModeMatch) oldMode = oldModeMatch[1];
  if (newModeMatch) newMode = newModeMatch[1];

  // Determine change type
  if (content.includes('new file mode')) {
    changeType = 'added';
  } else if (content.includes('deleted file mode')) {
    changeType = 'deleted';
  } else if (oldPath !== newPath) {
    changeType = 'renamed';
  }

  // Parse hunks
  const hunkPattern =
    /@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)?/g;
  let match: RegExpExecArray | null;

  while ((match = hunkPattern.exec(content)) !== null) {
    const oldStart = parseInt(match[1] ?? '1', 10);
    const oldLines = parseInt(match[2] ?? '1', 10);
    const newStart = parseInt(match[3] ?? '1', 10);
    const newLines = parseInt(match[4] ?? '1', 10);
    const header = match[5]?.trim();

    // Find the hunk content (until next hunk or end)
    const hunkStart = (match.index ?? 0) + match[0].length;
    const nextHunk = content.indexOf('\n@@', hunkStart);
    const hunkContent =
      nextHunk > -1
        ? content.slice(hunkStart, nextHunk)
        : content.slice(hunkStart);

    const lines = parseHunkLines(hunkContent, oldStart, newStart);

    const hunk: DiffHunk = {
      oldStart,
      oldLines,
      newStart,
      newLines,
      lines,
    };

    if (header) {
      hunk.header = header;
    }

    hunks.push(hunk);
  }

  const fileDiff: FileDiff = {
    oldPath,
    newPath,
    changeType,
    hunks,
    isBinary,
  };

  if (oldMode) {
    fileDiff.oldMode = oldMode;
  }

  if (newMode) {
    fileDiff.newMode = newMode;
  }

  return fileDiff;
}

/**
 * Parse lines within a hunk.
 *
 * @param content - Hunk content
 * @param oldStart - Starting line number in old file
 * @param newStart - Starting line number in new file
 * @returns Parsed diff lines
 */
function parseHunkLines(
  content: string,
  oldStart: number,
  newStart: number
): DiffLine[] {
  const lines: DiffLine[] = [];
  const rawLines = content.split('\n');

  let oldLine = oldStart;
  let newLine = newStart;

  for (const raw of rawLines) {
    if (raw === '' || raw.startsWith('\\')) {
      // Skip empty lines and "No newline at end of file"
      continue;
    }

    const prefix = raw[0];
    const lineContent = raw.slice(1);

    if (prefix === '+') {
      lines.push({
        type: 'add',
        content: lineContent,
        newLineNumber: newLine++,
      });
    } else if (prefix === '-') {
      lines.push({
        type: 'remove',
        content: lineContent,
        oldLineNumber: oldLine++,
      });
    } else if (prefix === ' ') {
      lines.push({
        type: 'context',
        content: lineContent,
        oldLineNumber: oldLine++,
        newLineNumber: newLine++,
      });
    }
  }

  return lines;
}

/**
 * Apply a parsed diff to file content.
 *
 * @param originalContent - Original file content
 * @param diff - Parsed diff for this file
 * @returns Application result
 */
export function applyDiff(
  originalContent: string,
  diff: FileDiff
): ApplyResult {
  if (diff.isBinary) {
    return {
      success: false,
      error: 'Cannot apply binary diffs',
    };
  }

  if (diff.changeType === 'added') {
    // New file - just combine all added lines
    const content = diff.hunks
      .flatMap((h) => h.lines.filter((l) => l.type === 'add'))
      .map((l) => l.content)
      .join('\n');

    return { success: true, content };
  }

  if (diff.changeType === 'deleted') {
    return { success: true, content: '' };
  }

  // Apply hunks in reverse order to maintain line numbers
  const originalLines = originalContent.split('\n');
  let resultLines = [...originalLines];
  const failedHunks: number[] = [];

  // Sort hunks by start line in reverse order
  const sortedHunks = [...diff.hunks].sort(
    (a, b) => b.oldStart - a.oldStart
  );

  for (let i = 0; i < sortedHunks.length; i++) {
    const hunk = sortedHunks[i];
    if (!hunk) continue;
    const result = applyHunk(resultLines, hunk);

    if (result.success && result.lines) {
      resultLines = result.lines;
    } else {
      failedHunks.push(diff.hunks.indexOf(hunk));
    }
  }

  if (failedHunks.length > 0) {
    return {
      success: false,
      error: `Failed to apply ${failedHunks.length} hunk(s)`,
      failedHunks,
      content: resultLines.join('\n'),
    };
  }

  return { success: true, content: resultLines.join('\n') };
}

/**
 * Apply a single hunk to lines.
 *
 * @param lines - Current file lines
 * @param hunk - Hunk to apply
 * @returns Application result with new lines
 */
function applyHunk(
  lines: string[],
  hunk: DiffHunk
): { success: boolean; lines?: string[] } {
  // Find the best match for this hunk
  const searchStart = Math.max(0, hunk.oldStart - 4); // Allow some fuzz
  const searchEnd = Math.min(lines.length, hunk.oldStart + 4);

  for (let offset = 0; offset <= searchEnd - searchStart; offset++) {
    // Try both positive and negative offsets
    for (const direction of [0, 1]) {
      const actualOffset = direction === 0 ? offset : -offset;
      const startLine = hunk.oldStart - 1 + actualOffset;

      if (startLine < 0 || startLine >= lines.length) {
        continue;
      }

      if (hunkMatches(lines, hunk, startLine)) {
        // Apply the hunk
        const newLines = [...lines];
        const removals = hunk.lines.filter((l) => l.type === 'remove').length;
        const additions = hunk.lines
          .filter((l) => l.type === 'add')
          .map((l) => l.content);

        newLines.splice(startLine, removals + getContextCount(hunk), ...additions);

        return { success: true, lines: newLines };
      }
    }
  }

  return { success: false };
}

/**
 * Check if a hunk matches at a given position.
 *
 * @param lines - File lines
 * @param hunk - Hunk to check
 * @param startLine - Starting line index (0-based)
 * @returns True if hunk matches
 */
function hunkMatches(
  lines: string[],
  hunk: DiffHunk,
  startLine: number
): boolean {
  let lineIndex = startLine;

  for (const diffLine of hunk.lines) {
    if (diffLine.type === 'add') {
      // Added lines don't need to match
      continue;
    }

    // Context and removed lines must match
    if (lineIndex >= lines.length) {
      return false;
    }

    if (lines[lineIndex] !== diffLine.content) {
      return false;
    }

    lineIndex++;
  }

  return true;
}

/**
 * Get the number of context lines in a hunk.
 *
 * @param hunk - The hunk
 * @returns Number of context lines
 */
function getContextCount(hunk: DiffHunk): number {
  return hunk.lines.filter((l) => l.type === 'context').length;
}

/**
 * Format a diff for display.
 *
 * @param diff - Parsed diff
 * @param options - Formatting options
 * @returns Formatted diff string
 */
export function formatDiff(
  diff: ParsedDiff,
  options: FormatOptions = {}
): string {
  const {
    includeHeaders = true,
    includeTimestamps = false,
    colorize = false,
  } = options;

  const lines: string[] = [];

  for (const file of diff.files) {
    if (includeHeaders) {
      lines.push(`diff --git a/${file.oldPath} b/${file.newPath}`);

      if (file.changeType === 'added') {
        lines.push('new file mode 100644');
      } else if (file.changeType === 'deleted') {
        lines.push('deleted file mode 100644');
      }

      const timestamp = includeTimestamps
        ? `\t${new Date().toISOString()}`
        : '';
      lines.push(`--- a/${file.oldPath}${timestamp}`);
      lines.push(`+++ b/${file.newPath}${timestamp}`);
    }

    for (const hunk of file.hunks) {
      const header = hunk.header ? ` ${hunk.header}` : '';
      const hunkLine = `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@${header}`;

      if (colorize) {
        lines.push(`${COLORS.cyan}${hunkLine}${COLORS.reset}`);
      } else {
        lines.push(hunkLine);
      }

      for (const line of hunk.lines) {
        let formatted: string;
        const prefix = line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' ';

        if (colorize) {
          const color =
            line.type === 'add'
              ? COLORS.green
              : line.type === 'remove'
                ? COLORS.red
                : COLORS.dim;
          formatted = `${color}${prefix}${line.content}${COLORS.reset}`;
        } else {
          formatted = `${prefix}${line.content}`;
        }

        lines.push(formatted);
      }
    }
  }

  return lines.join('\n');
}

/**
 * Create a unified diff from two strings.
 *
 * @param oldContent - Original content
 * @param newContent - New content
 * @param filePath - File path for headers
 * @param context - Number of context lines
 * @returns Unified diff string
 */
export function createDiff(
  oldContent: string,
  newContent: string,
  filePath: string,
  context = 3
): string {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');

  // Simple diff algorithm (not optimal but functional)
  const hunks = computeHunks(oldLines, newLines, context);

  if (hunks.length === 0) {
    return ''; // No changes
  }

  const lines: string[] = [
    `diff --git a/${filePath} b/${filePath}`,
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
  ];

  for (const hunk of hunks) {
    lines.push(
      `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`
    );

    for (const line of hunk.lines) {
      const prefix =
        line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' ';
      lines.push(`${prefix}${line.content}`);
    }
  }

  return lines.join('\n');
}

/**
 * Compute hunks using a simple LCS-based diff algorithm.
 *
 * @param oldLines - Original lines
 * @param newLines - New lines
 * @param context - Context lines to include
 * @returns Computed hunks
 */
function computeHunks(
  oldLines: string[],
  newLines: string[],
  context: number
): DiffHunk[] {
  // Find changes using simple comparison
  const changes: Array<{ type: 'same' | 'remove' | 'add'; oldIdx?: number; newIdx?: number; content: string }> = [];

  let oldIdx = 0;
  let newIdx = 0;

  while (oldIdx < oldLines.length || newIdx < newLines.length) {
    if (oldIdx >= oldLines.length) {
      // Rest are additions
      changes.push({
        type: 'add',
        newIdx,
        content: newLines[newIdx] ?? '',
      });
      newIdx++;
    } else if (newIdx >= newLines.length) {
      // Rest are removals
      changes.push({
        type: 'remove',
        oldIdx,
        content: oldLines[oldIdx] ?? '',
      });
      oldIdx++;
    } else if (oldLines[oldIdx] === newLines[newIdx]) {
      // Same line
      changes.push({
        type: 'same',
        oldIdx,
        newIdx,
        content: oldLines[oldIdx] ?? '',
      });
      oldIdx++;
      newIdx++;
    } else {
      // Check if it's a removal or addition
      const oldInNew = newLines.indexOf(oldLines[oldIdx] ?? '', newIdx);
      const newInOld = oldLines.indexOf(newLines[newIdx] ?? '', oldIdx);

      if (oldInNew === -1 && newInOld === -1) {
        // Both changed - treat as remove + add
        changes.push({
          type: 'remove',
          oldIdx,
          content: oldLines[oldIdx] ?? '',
        });
        changes.push({
          type: 'add',
          newIdx,
          content: newLines[newIdx] ?? '',
        });
        oldIdx++;
        newIdx++;
      } else if (oldInNew !== -1 && (newInOld === -1 || oldInNew - newIdx < newInOld - oldIdx)) {
        // Addition
        changes.push({
          type: 'add',
          newIdx,
          content: newLines[newIdx] ?? '',
        });
        newIdx++;
      } else {
        // Removal
        changes.push({
          type: 'remove',
          oldIdx,
          content: oldLines[oldIdx] ?? '',
        });
        oldIdx++;
      }
    }
  }

  // Group changes into hunks with context
  const hunks: DiffHunk[] = [];
  let currentHunk: DiffHunk | null = null;
  let lastChangeIdx = -context - 1;

  for (let i = 0; i < changes.length; i++) {
    const change = changes[i];
    if (!change) continue;

    if (change.type !== 'same') {
      // Start new hunk or extend current
      if (!currentHunk || i - lastChangeIdx > context * 2) {
        // Start new hunk with leading context
        if (currentHunk) {
          hunks.push(currentHunk);
        }

        const contextStart = Math.max(0, i - context);
        currentHunk = {
          oldStart: (changes[contextStart]?.oldIdx ?? 0) + 1,
          oldLines: 0,
          newStart: (changes[contextStart]?.newIdx ?? 0) + 1,
          newLines: 0,
          lines: [],
        };

        // Add leading context
        for (let j = contextStart; j < i; j++) {
          const ctx = changes[j];
          if (ctx && ctx.type === 'same') {
            currentHunk.lines.push({ type: 'context', content: ctx.content });
            currentHunk.oldLines++;
            currentHunk.newLines++;
          }
        }
      }

      // Add the change
      if (change.type === 'remove') {
        currentHunk.lines.push({ type: 'remove', content: change.content });
        currentHunk.oldLines++;
      } else {
        currentHunk.lines.push({ type: 'add', content: change.content });
        currentHunk.newLines++;
      }

      lastChangeIdx = i;
    } else if (currentHunk && i - lastChangeIdx <= context) {
      // Add trailing context
      currentHunk.lines.push({ type: 'context', content: change.content });
      currentHunk.oldLines++;
      currentHunk.newLines++;
    }
  }

  if (currentHunk && currentHunk.lines.length > 0) {
    hunks.push(currentHunk);
  }

  return hunks;
}

/**
 * Extract the affected line range from a diff.
 *
 * @param diff - Parsed diff
 * @returns Object with start and end line numbers
 */
export function getAffectedLineRange(diff: FileDiff): {
  start: number;
  end: number;
} {
  if (diff.hunks.length === 0) {
    return { start: 1, end: 1 };
  }

  const firstHunk = diff.hunks[0];
  const lastHunk = diff.hunks[diff.hunks.length - 1];

  return {
    start: firstHunk?.newStart ?? 1,
    end: (lastHunk?.newStart ?? 1) + (lastHunk?.newLines ?? 1) - 1,
  };
}

/**
 * Check if two diffs are equivalent (same changes).
 *
 * @param diff1 - First diff
 * @param diff2 - Second diff
 * @returns True if diffs are equivalent
 */
export function diffsEqual(diff1: ParsedDiff, diff2: ParsedDiff): boolean {
  if (diff1.files.length !== diff2.files.length) {
    return false;
  }

  for (let i = 0; i < diff1.files.length; i++) {
    const file1 = diff1.files[i];
    const file2 = diff2.files[i];

    if (!file1 || !file2) {
      return false;
    }

    if (file1.newPath !== file2.newPath) {
      return false;
    }

    const lines1 = file1.hunks.flatMap((h) =>
      h.lines.filter((l) => l.type !== 'context')
    );
    const lines2 = file2.hunks.flatMap((h) =>
      h.lines.filter((l) => l.type !== 'context')
    );

    if (lines1.length !== lines2.length) {
      return false;
    }

    for (let j = 0; j < lines1.length; j++) {
      if (
        lines1[j]?.type !== lines2[j]?.type ||
        lines1[j]?.content !== lines2[j]?.content
      ) {
        return false;
      }
    }
  }

  return true;
}
