import { z } from 'zod';
import { Issue, VerifyResult } from '../base.js';

// ============================================================================
// Verify Types
// ============================================================================

export interface VerifyPromptOptions {
  issue: Issue;
  diff: string;
  originalContent: string;
  newContent: string;
  filePath: string;
  language?: string;
  additionalContext?: string;
}

// ============================================================================
// System Prompt
// ============================================================================

export const VERIFY_SYSTEM_PROMPT = `You are an expert code reviewer specializing in verifying code fixes. Your task is to determine whether a proposed fix correctly addresses an identified issue without introducing new problems.

## Verification Criteria

1. **Correctness**: Does the fix actually solve the reported issue?
2. **Completeness**: Does the fix address all aspects of the issue?
3. **No Regressions**: Does the fix avoid breaking existing functionality?
4. **No New Issues**: Does the fix avoid introducing new bugs, security issues, or performance problems?
5. **Code Quality**: Does the fix maintain or improve code quality?
6. **Minimal Impact**: Is the change appropriately scoped and minimal?

## What to Look For

### Positive Indicators
- Fix directly addresses the root cause
- Code is syntactically correct
- Logic handles edge cases
- Style matches existing code
- No unnecessary changes

### Red Flags
- Fix only addresses symptoms, not root cause
- New bugs or vulnerabilities introduced
- Missing edge case handling
- Breaking changes to API or behavior
- Overly broad changes beyond the issue scope
- Style inconsistencies
- Missing error handling

## Response Format

Provide a JSON object with:
- **isValid**: Boolean - true if fix is acceptable, false otherwise
- **reasoning**: Detailed explanation of your assessment
- **concerns**: Array of specific concerns (empty if none)
- **suggestions**: Optional array of improvement suggestions
- **confidence**: Confidence score (0-1) in the assessment`;

// ============================================================================
// User Prompt Generation
// ============================================================================

export function generateVerifyUserPrompt(options: VerifyPromptOptions): string {
  const {
    issue,
    diff,
    originalContent,
    newContent,
    filePath,
    language,
    additionalContext,
  } = options;

  const parts: string[] = [];

  // Issue that was being fixed
  parts.push('## Original Issue');
  parts.push('');
  parts.push(`**ID**: ${issue.id}`);
  parts.push(`**Title**: ${issue.title}`);
  parts.push(`**Severity**: ${issue.severity}`);
  parts.push(`**Category**: ${issue.category}`);
  parts.push(`**Location**: ${issue.location.file}:${String(issue.location.startLine)}-${String(issue.location.endLine)}`);
  parts.push('');
  parts.push('**Description**:');
  parts.push(issue.description);
  parts.push('');

  if (issue.suggestedFix !== undefined && issue.suggestedFix !== '') {
    parts.push('**Original Suggested Fix**:');
    parts.push(issue.suggestedFix);
    parts.push('');
  }

  // The proposed diff
  parts.push('## Proposed Fix (Diff)');
  parts.push('');
  parts.push('```diff');
  parts.push(diff);
  parts.push('```');
  parts.push('');

  // Original file content (relevant section)
  const detectedLang = language ?? detectLanguage(filePath);
  parts.push(`## Original Code: ${filePath}`);
  parts.push('');
  parts.push('```' + detectedLang);
  parts.push(formatWithLineNumbers(originalContent, issue.location.startLine, issue.location.endLine));
  parts.push('```');
  parts.push('');

  // New file content (relevant section)
  parts.push('## Modified Code');
  parts.push('');
  parts.push('```' + detectedLang);
  parts.push(formatWithLineNumbers(newContent, issue.location.startLine, issue.location.endLine));
  parts.push('```');
  parts.push('');

  // Additional context
  if (additionalContext !== undefined && additionalContext !== '') {
    parts.push('## Additional Context');
    parts.push(additionalContext);
    parts.push('');
  }

  // Verification questions
  parts.push('## Verification Questions');
  parts.push('Please evaluate:');
  parts.push('');
  parts.push('1. Does this fix correctly address the issue described?');
  parts.push('2. Does the fix handle all relevant edge cases?');
  parts.push('3. Are there any potential bugs or issues introduced by this fix?');
  parts.push('4. Is the fix appropriately minimal and focused?');
  parts.push('5. Does the code style match the existing codebase?');
  parts.push('');

  // Category-specific checks
  parts.push('## Category-Specific Checks');
  parts.push(getCategorySpecificChecks(issue.category));
  parts.push('');

  // Response format
  parts.push('## Required Response Format');
  parts.push('Respond with a valid JSON object:');
  parts.push('```json');
  parts.push(JSON.stringify(VERIFY_RESPONSE_TEMPLATE, null, 2));
  parts.push('```');

  return parts.join('\n');
}

// ============================================================================
// Category-Specific Verification
// ============================================================================

function getCategorySpecificChecks(category: string): string {
  const checks: Record<string, string> = {
    bug: `For bug fixes, verify:
- The logical error has been corrected
- No new logic errors introduced
- Edge cases are handled
- Error paths are tested`,

    security: `For security fixes, verify:
- The vulnerability is fully mitigated
- No new attack vectors introduced
- Input validation is complete
- Sensitive data is protected
- No security anti-patterns used`,

    performance: `For performance fixes, verify:
- The optimization addresses the bottleneck
- No functionality regression
- Memory usage is appropriate
- Algorithm complexity is improved
- No premature optimization trade-offs`,

    maintainability: `For maintainability fixes, verify:
- Code is more readable
- Abstractions are appropriate
- No over-engineering
- Naming is clear
- Structure is logical`,

    style: `For style fixes, verify:
- Formatting matches project standards
- Only style changes made
- No functional changes
- Consistency maintained`,

    complexity: `For complexity fixes, verify:
- Logic is preserved
- Code is more understandable
- Appropriate decomposition
- No premature abstraction`,

    duplication: `For duplication fixes, verify:
- Abstraction is appropriate
- All instances updated
- No functionality change
- Reuse is practical`,

    documentation: `For documentation fixes, verify:
- Documentation is accurate
- Matches current behavior
- Follows doc conventions
- No code changes`,

    testing: `For testability fixes, verify:
- Code is more modular
- Dependencies injectable
- No behavior change
- Test surface improved`,
  };

  return checks[category] ?? `Verify that the fix:
- Addresses the issue correctly
- Introduces no new problems
- Is minimal and focused`;
}

// ============================================================================
// Response Template
// ============================================================================

const VERIFY_RESPONSE_TEMPLATE = {
  isValid: true,
  reasoning: 'Detailed explanation of why the fix is valid or invalid',
  concerns: [
    'Any specific concerns about the fix (empty array if none)',
  ],
  suggestions: [
    'Optional suggestions for improvement',
  ],
  confidence: 0.9,
};

// ============================================================================
// Response Parsing
// ============================================================================

const PartialVerifyResultSchema = z.object({
  isValid: z.boolean(),
  reasoning: z.string(),
  concerns: z.array(z.string()),
  suggestions: z.array(z.string()).optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export function parseVerifyResponse(response: string): VerifyResult {
  // Extract JSON from response
  let jsonStr = response;

  const codeBlockMatch = /```(?:json)?\s*([\s\S]*?)```/.exec(response);
  if (codeBlockMatch?.[1] !== undefined && codeBlockMatch[1] !== '') {
    jsonStr = codeBlockMatch[1].trim();
  }

  const jsonMatch = /\{[\s\S]*\}/.exec(jsonStr);
  if (jsonMatch?.[0] !== undefined && jsonMatch[0] !== '') {
    jsonStr = jsonMatch[0];
  }

  // Parse and validate
  const parsed: unknown = JSON.parse(jsonStr);
  const partial = PartialVerifyResultSchema.parse(parsed);

  return {
    isValid: partial.isValid,
    reasoning: partial.reasoning,
    concerns: partial.concerns,
    suggestions: partial.suggestions,
    confidence: partial.confidence ?? 0.8,
  };
}

// ============================================================================
// Quick Verification Prompt
// ============================================================================

export function generateQuickVerifyPrompt(
  issue: Issue,
  diff: string,
): string {
  return `Quickly verify if this diff fixes the issue.

Issue: ${issue.title}
${issue.description}

Diff:
\`\`\`diff
${diff}
\`\`\`

Respond with JSON: {"isValid": boolean, "reasoning": "brief reason", "concerns": [], "confidence": number}`;
}

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
  };
  return languageMap[ext] ?? ext;
}

function formatWithLineNumbers(
  content: string,
  highlightStart: number,
  highlightEnd: number,
  contextLines = 5,
): string {
  const lines = content.split('\n');
  const start = Math.max(0, highlightStart - contextLines - 1);
  const end = Math.min(lines.length, highlightEnd + contextLines);
  const width = String(end).length;

  return lines
    .slice(start, end)
    .map((line, i) => {
      const lineNum = start + i + 1;
      const prefix = String(lineNum).padStart(width);
      const marker = lineNum >= highlightStart && lineNum <= highlightEnd ? '>' : ' ';
      return `${marker}${prefix} | ${line}`;
    })
    .join('\n');
}
