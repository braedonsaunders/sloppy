/**
 * LLM Analysis Prompts
 *
 * Prompts for LLM-based code analysis that detects issues
 * beyond what static analyzers can find.
 */

import type { IssueCategory, Severity } from '../base.js';

/**
 * System prompt for deep code analysis
 */
export const LLM_ANALYSIS_SYSTEM_PROMPT = `You are an expert code quality analyst with deep expertise in software engineering, security vulnerabilities, performance optimization, and maintainable code design.

Your task is to analyze source code and identify issues that static analyzers miss:

## What to Look For

### Logic Bugs
- Off-by-one errors in loops and array indexing
- Incorrect conditional logic (wrong operators, missing conditions)
- Race conditions and timing issues
- State management bugs
- Incorrect null/undefined handling
- Edge cases not handled
- Type coercion issues

### Security Issues
- Injection vulnerabilities (SQL, command, XSS)
- Authentication/authorization flaws
- Insecure data handling
- Sensitive data exposure
- Missing input validation
- CSRF vulnerabilities
- Insecure cryptographic usage

### Code Smells
- Functions doing too much (Single Responsibility violation)
- Deep nesting that harms readability
- Magic numbers/strings without explanation
- Duplicated logic that should be abstracted
- Misleading variable/function names
- Dead code or unreachable branches
- Overly complex conditionals

### Error Handling Issues
- Missing try/catch around fallible operations
- Swallowed errors (catch blocks that do nothing)
- Error messages that don't help debugging
- Missing error recovery or cleanup
- Unhandled promise rejections
- Missing finally blocks for cleanup

### Performance Issues
- N+1 query patterns
- Unnecessary iterations or computations
- Missing memoization for expensive operations
- Memory leaks (event listeners, closures, timers)
- Blocking operations in async contexts
- Inefficient data structures

### API/Contract Issues
- Functions that don't do what their name suggests
- Missing parameter validation
- Inconsistent return types
- Breaking API contracts
- Missing or incorrect TypeScript types

## Response Format
Respond ONLY with valid JSON matching this exact structure:
{
  "issues": [
    {
      "type": "bug|security|lint|stub|duplicate|dead-code|coverage|type",
      "severity": "error|warning|info|hint",
      "title": "Brief, descriptive title",
      "description": "Detailed explanation of why this is an issue",
      "file": "path/to/file.ts",
      "lineStart": 10,
      "lineEnd": 15,
      "suggestedFix": "Specific suggestion for how to fix this",
      "confidence": 0.85
    }
  ],
  "summary": "Brief summary of overall code quality",
  "filesAnalyzed": ["file1.ts", "file2.ts"]
}

## Important Guidelines
1. Only report real issues you are confident about (confidence > 0.7)
2. Be specific - include exact line numbers and clear descriptions
3. Prioritize security and bug issues over style issues
4. Don't report issues already caught by linters (formatting, unused vars, etc.)
5. Focus on issues that require human judgment to detect
6. Provide actionable fix suggestions
7. Don't report more than 20 issues per analysis`;

/**
 * System prompt for agentic file exploration
 */
export const FILE_EXPLORER_SYSTEM_PROMPT = `You are a code exploration assistant that helps analyze codebases intelligently.

Your role is to examine file contents and identify:
1. Files that need deeper analysis
2. Related files that should be analyzed together
3. Entry points and critical paths

When given a list of files, you should:
1. Identify the most important files to analyze first
2. Group related files that should be analyzed together
3. Prioritize based on:
   - File type (source > config > docs)
   - File name (index, main, app files first)
   - Imports/exports (files with many imports are integration points)
   - File size (larger files may have more issues)

Respond with JSON:
{
  "prioritizedFiles": [
    {
      "path": "src/index.ts",
      "reason": "Main entry point",
      "relatedFiles": ["src/config.ts", "src/utils.ts"]
    }
  ],
  "analysisGroups": [
    {
      "name": "Core Business Logic",
      "files": ["src/services/auth.ts", "src/services/users.ts"],
      "reason": "These files handle authentication and user management"
    }
  ]
}`;

/**
 * User prompt template for code analysis
 */
export function generateAnalysisPrompt(
  files: { path: string; content: string }[],
  context?: string
): string {
  const parts: string[] = [];

  if (context !== undefined && context !== '') {
    parts.push('## Context');
    parts.push(context);
    parts.push('');
  }

  parts.push('## Files to Analyze');
  parts.push('');

  for (const file of files) {
    const language = detectLanguage(file.path);
    parts.push(`### ${file.path}`);
    parts.push('```' + language);
    parts.push(file.content);
    parts.push('```');
    parts.push('');
  }

  parts.push('Analyze these files and respond with the JSON structure specified in the system prompt.');

  return parts.join('\n');
}

/**
 * Prompt for exploring and prioritizing files
 */
export function generateExplorationPrompt(
  files: string[],
  projectContext?: string
): string {
  const parts: string[] = [];

  parts.push('## Available Files');
  parts.push('```');
  parts.push(files.join('\n'));
  parts.push('```');
  parts.push('');

  if (projectContext !== undefined && projectContext !== '') {
    parts.push('## Project Context');
    parts.push(projectContext);
    parts.push('');
  }

  parts.push('Analyze this file list and prioritize files for deep code analysis.');
  parts.push('Respond with JSON as specified in the system prompt.');

  return parts.join('\n');
}

/**
 * Prompt for re-analysis after fixes
 */
export function generateReAnalysisPrompt(
  file: { path: string; content: string },
  previousIssue: {
    description: string;
    lineStart: number;
    lineEnd: number;
  },
  appliedFix: string
): string {
  const language = detectLanguage(file.path);

  return `## Re-Analysis Request

A fix was applied to address this issue:

### File
${file.path}

### Original Issue
${previousIssue.description}
(Lines ${String(previousIssue.lineStart)}-${String(previousIssue.lineEnd)})

### Applied Fix
${appliedFix}

### Current File Content
\`\`\`${language}
${file.content}
\`\`\`

Please analyze if:
1. The fix correctly addresses the original issue
2. The fix introduced any new issues
3. There are any remaining related issues

Respond with JSON:
{
  "originalIssueResolved": true|false,
  "resolutionAssessment": "Explanation of whether the fix worked",
  "newIssues": [...],  // Same format as regular analysis
  "remainingConcerns": ["Any lingering concerns about this code"]
}`;
}

/**
 * Map LLM category to analyzer category
 */
export function mapToIssueCategory(llmCategory: string): IssueCategory {
  const mapping: Record<string, IssueCategory> = {
    'bug': 'bug',
    'logic': 'bug',
    'security': 'security',
    'vulnerability': 'security',
    'performance': 'bug',
    'style': 'lint',
    'lint': 'lint',
    'maintainability': 'lint',
    'complexity': 'lint',
    'stub': 'stub',
    'todo': 'stub',
    'fixme': 'stub',
    'duplicate': 'duplicate',
    'duplication': 'duplicate',
    'dead-code': 'dead-code',
    'deadcode': 'dead-code',
    'unused': 'dead-code',
    'coverage': 'coverage',
    'test': 'coverage',
    'type': 'type',
    'typescript': 'type',
  };

  return mapping[llmCategory.toLowerCase()] ?? 'bug';
}

/**
 * Map LLM severity to analyzer severity
 */
export function mapToSeverity(llmSeverity: string): Severity {
  const mapping: Record<string, Severity> = {
    'critical': 'error',
    'error': 'error',
    'high': 'error',
    'warning': 'warning',
    'medium': 'warning',
    'info': 'info',
    'low': 'info',
    'hint': 'hint',
    'suggestion': 'hint',
  };

  return mapping[llmSeverity.toLowerCase()] ?? 'warning';
}

/**
 * Detect programming language from file extension
 */
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
    sql: 'sql',
    sh: 'bash',
    bash: 'bash',
    zsh: 'bash',
    yml: 'yaml',
    yaml: 'yaml',
    json: 'json',
    xml: 'xml',
    html: 'html',
    css: 'css',
    scss: 'scss',
    vue: 'vue',
    svelte: 'svelte',
  };
  return languageMap[ext] ?? ext;
}
