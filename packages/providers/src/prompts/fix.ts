import { z } from 'zod';
import { Issue, FixResult, FixResultSchema } from '../base.js';

// ============================================================================
// Fix Types
// ============================================================================

export interface FixPromptOptions {
  issue: Issue;
  fileContent: string;
  filePath: string;
  language?: string;
  additionalContext?: string;
  preferMinimalChanges?: boolean;
  preserveFormatting?: boolean;
}

// ============================================================================
// System Prompts
// ============================================================================

export const FIX_SYSTEM_PROMPT = `You are an expert software engineer specializing in code fixes and improvements. Your task is to generate precise, minimal fixes for identified code issues.

## Fix Guidelines

1. **Minimal Changes**: Make the smallest possible change that addresses the issue completely
2. **Preserve Intent**: Maintain the original code's intent and behavior except where the fix requires changes
3. **Preserve Style**: Match the existing code style, formatting, and conventions
4. **No Side Effects**: Avoid introducing new issues or changing unrelated functionality
5. **Complete Fix**: Ensure the fix fully resolves the issue, not just partially
6. **Production Ready**: Generate code that is ready for production use
7. **Consider Edge Cases**: Account for edge cases that might be affected by the fix

## Response Requirements

Provide your response as a JSON object with:
- **success**: Boolean indicating if a fix was generated
- **diff**: Unified diff format showing the changes
- **newContent**: The complete updated file content
- **explanation**: Clear explanation of what was changed and why
- **confidence**: Confidence score (0-1) in the fix's correctness
- **sideEffects**: Array of potential side effects to be aware of
- **alternativeFixes**: Optional array of alternative fix approaches

## Diff Format

Use standard unified diff format:
\`\`\`diff
--- a/filename
+++ b/filename
@@ -line,count +line,count @@
 context line
-removed line
+added line
 context line
\`\`\``;

export const FIX_TYPE_INSTRUCTIONS: Record<string, string> = {
  bug: `Fix this bug while ensuring:
- The fix addresses the root cause, not just symptoms
- All related edge cases are handled
- No regression in existing functionality
- Error handling is appropriate`,

  security: `Fix this security vulnerability while ensuring:
- The fix completely eliminates the vulnerability
- No new attack vectors are introduced
- Secure coding practices are followed
- Input validation is thorough where applicable`,

  performance: `Fix this performance issue while ensuring:
- The optimization is measurably effective
- Code readability is maintained where possible
- No functionality is changed
- Memory and CPU implications are considered`,

  maintainability: `Improve maintainability while ensuring:
- Code is more readable and understandable
- Changes follow established patterns in the codebase
- No functionality is changed
- Comments are added where helpful`,

  style: `Fix this style issue while ensuring:
- Changes match the project's style guide
- Consistency with surrounding code
- No functional changes
- Formatting is correct`,

  complexity: `Reduce complexity while ensuring:
- Logic is preserved exactly
- Code is more readable
- Functions/methods are appropriately sized
- Nesting depth is reduced where possible`,

  duplication: `Remove code duplication while ensuring:
- Shared logic is properly abstracted
- No functionality is changed
- The abstraction is appropriately placed
- All usages are updated`,

  documentation: `Improve documentation while ensuring:
- Comments are clear and accurate
- JSDoc/docstrings follow conventions
- No code changes beyond comments
- Documentation matches current behavior`,

  testing: `Improve testability while ensuring:
- Code is more modular
- Dependencies are injectable
- No functionality is changed
- Test boundaries are clear`,

  default: `Fix this issue while ensuring:
- The root cause is addressed
- No side effects are introduced
- Code quality is maintained
- The fix is complete`,
};

// ============================================================================
// User Prompt Generation
// ============================================================================

export function generateFixUserPrompt(options: FixPromptOptions): string {
  const {
    issue,
    fileContent,
    filePath,
    language,
    additionalContext,
    preferMinimalChanges = true,
    preserveFormatting = true,
  } = options;

  const parts: string[] = [];

  // Issue details
  parts.push('## Issue to Fix');
  parts.push('');
  parts.push(`**ID**: ${issue.id}`);
  parts.push(`**Title**: ${issue.title}`);
  parts.push(`**Severity**: ${issue.severity}`);
  parts.push(`**Category**: ${issue.category}`);
  parts.push(`**Location**: ${issue.location.file}:${issue.location.startLine}-${issue.location.endLine}`);
  parts.push('');
  parts.push('**Description**:');
  parts.push(issue.description);
  parts.push('');

  if (issue.suggestedFix) {
    parts.push('**Suggested Fix**:');
    parts.push(issue.suggestedFix);
    parts.push('');
  }

  // Category-specific instructions
  const categoryInstructions = FIX_TYPE_INSTRUCTIONS[issue.category];
  const defaultInstructions = FIX_TYPE_INSTRUCTIONS['default'];
  const instructions = categoryInstructions ?? defaultInstructions ?? '';
  parts.push('## Fix Requirements');
  parts.push(instructions);
  parts.push('');

  // Constraints
  parts.push('## Constraints');
  if (preferMinimalChanges) {
    parts.push('- Make the minimal change necessary to fix the issue');
  }
  if (preserveFormatting) {
    parts.push('- Preserve existing code formatting and style');
  }
  parts.push('- Do not modify code unrelated to the fix');
  parts.push('- Ensure the fix compiles and is syntactically correct');
  parts.push('');

  // Additional context
  if (additionalContext) {
    parts.push('## Additional Context');
    parts.push(additionalContext);
    parts.push('');
  }

  // File content
  parts.push(`## File: ${filePath}`);
  parts.push('');
  parts.push('```' + (language ?? detectLanguage(filePath)));
  parts.push(addLineNumbers(fileContent));
  parts.push('```');
  parts.push('');

  // Highlight the relevant section
  parts.push('## Relevant Code Section');
  parts.push(`Lines ${issue.location.startLine}-${issue.location.endLine}:`);
  parts.push('');
  parts.push('```' + (language ?? detectLanguage(filePath)));
  parts.push(extractLines(fileContent, issue.location.startLine, issue.location.endLine));
  parts.push('```');
  parts.push('');

  // Response format
  parts.push('## Required Response Format');
  parts.push('Respond with a valid JSON object:');
  parts.push('```json');
  parts.push(JSON.stringify(FIX_RESPONSE_TEMPLATE, null, 2));
  parts.push('```');

  return parts.join('\n');
}

// ============================================================================
// Response Template
// ============================================================================

const FIX_RESPONSE_TEMPLATE = {
  success: true,
  diff: '--- a/file.ts\n+++ b/file.ts\n@@ -10,3 +10,3 @@\n context\n-old line\n+new line\n context',
  newContent: '// Complete updated file content here',
  explanation: 'Explanation of what was changed and why',
  confidence: 0.95,
  sideEffects: ['Potential side effect 1'],
  alternativeFixes: [
    {
      diff: 'Alternative diff',
      explanation: 'Alternative approach explanation',
    },
  ],
};

// ============================================================================
// Response Parsing
// ============================================================================

const PartialFixResultSchema = z.object({
  success: z.boolean(),
  diff: z.string(),
  newContent: z.string(),
  explanation: z.string(),
  confidence: z.number().min(0).max(1).optional(),
  sideEffects: z.array(z.string()).optional(),
  alternativeFixes: z.array(z.object({
    diff: z.string(),
    explanation: z.string(),
  })).optional(),
});

export function parseFixResponse(response: string): FixResult {
  // Extract JSON from response
  let jsonStr = response;

  const codeBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch?.[1]) {
    jsonStr = codeBlockMatch[1].trim();
  }

  const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (jsonMatch?.[0]) {
    jsonStr = jsonMatch[0];
  }

  // Parse and validate
  const parsed = JSON.parse(jsonStr);
  const partial = PartialFixResultSchema.parse(parsed);

  return {
    success: partial.success,
    diff: partial.diff,
    newContent: partial.newContent,
    explanation: partial.explanation,
    confidence: partial.confidence ?? 0.8,
    sideEffects: partial.sideEffects,
    alternativeFixes: partial.alternativeFixes,
  };
}

// ============================================================================
// Diff Generation Instructions
// ============================================================================

export const DIFF_GENERATION_INSTRUCTIONS = `
## How to Generate a Unified Diff

1. Start with file headers:
   \`\`\`
   --- a/original_file.ts
   +++ b/modified_file.ts
   \`\`\`

2. For each changed region, create a hunk header:
   \`\`\`
   @@ -original_start,original_count +modified_start,modified_count @@
   \`\`\`
   - original_start: Line number in original file
   - original_count: Number of lines in original version
   - modified_start: Line number in modified file
   - modified_count: Number of lines in modified version

3. Mark lines:
   - \` \` (space): Unchanged context line
   - \`-\`: Line removed from original
   - \`+\`: Line added in modified

4. Include 3 lines of context before and after changes

Example:
\`\`\`diff
--- a/example.ts
+++ b/example.ts
@@ -8,7 +8,7 @@
 import { something } from './something';

 function calculate(value: number): number {
-  return value * 2;
+  return value * 2 + 1;
 }

 export { calculate };
\`\`\`
`;

// ============================================================================
// Utilities
// ============================================================================

function detectLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const languageMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    py: 'python',
    rb: 'ruby',
    go: 'go',
    rs: 'rust',
    java: 'java',
    kt: 'kotlin',
    swift: 'swift',
    cs: 'csharp',
    cpp: 'cpp',
    c: 'c',
    h: 'c',
    hpp: 'cpp',
    php: 'php',
  };
  return languageMap[ext] ?? ext;
}

function addLineNumbers(content: string): string {
  const lines = content.split('\n');
  const width = String(lines.length).length;
  return lines
    .map((line, i) => `${String(i + 1).padStart(width)} | ${line}`)
    .join('\n');
}

function extractLines(content: string, startLine: number, endLine: number): string {
  const lines = content.split('\n');
  const start = Math.max(0, startLine - 1);
  const end = Math.min(lines.length, endLine);
  const extracted = lines.slice(start, end);
  const width = String(endLine).length;
  return extracted
    .map((line, i) => `${String(start + i + 1).padStart(width)} | ${line}`)
    .join('\n');
}
