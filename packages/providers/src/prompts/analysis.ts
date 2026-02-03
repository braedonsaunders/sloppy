import { z } from 'zod';
import {
  AnalysisResult,
  AnalysisResultSchema,
  Issue,
  IssueCategory,
  IssueSeverity,
} from '../base.js';

// ============================================================================
// Analysis Types
// ============================================================================

export type AnalysisType =
  | 'full'
  | 'security'
  | 'performance'
  | 'maintainability'
  | 'bugs'
  | 'style'
  | 'quick';

export interface AnalysisPromptOptions {
  type: AnalysisType;
  files: Array<{ path: string; content: string; language?: string }>;
  context?: string;
  focusAreas?: string[];
  ignorePatterns?: string[];
  maxIssues?: number;
  minSeverity?: IssueSeverity;
}

// ============================================================================
// System Prompts
// ============================================================================

export const ANALYSIS_SYSTEM_PROMPT = `You are an expert code quality analyst with deep expertise in software engineering best practices, security vulnerabilities, performance optimization, and maintainable code design.

Your task is to analyze source code and identify issues across multiple dimensions:

## Issue Categories
- **bug**: Logic errors, incorrect implementations, potential runtime errors
- **security**: Vulnerabilities, unsafe practices, data exposure risks
- **performance**: Inefficient algorithms, unnecessary operations, memory leaks
- **maintainability**: Complex code, poor structure, lack of modularity
- **style**: Inconsistent formatting, naming conventions, code organization
- **complexity**: Overly complex logic, deep nesting, long functions
- **duplication**: Repeated code patterns, copy-paste code
- **documentation**: Missing or inadequate documentation, unclear comments
- **testing**: Missing tests, untestable code, poor test coverage
- **accessibility**: Accessibility issues (for UI code)
- **compatibility**: Browser/platform compatibility issues
- **other**: Issues that don't fit other categories

## Severity Levels
- **error**: Critical issues that will cause bugs, security vulnerabilities, or system failures
- **warning**: Significant issues that should be addressed but won't cause immediate failures
- **info**: Suggestions for improvement that are not critical
- **hint**: Minor suggestions or style preferences

## Analysis Guidelines
1. Be thorough but prioritize high-impact issues
2. Provide specific, actionable feedback with clear explanations
3. Include line numbers and code references
4. Suggest fixes when possible
5. Consider the broader context of the codebase
6. Avoid false positives - only report real issues
7. Consider language-specific best practices
8. Look for patterns, not just individual issues

## Response Format
Respond with a JSON object containing:
- issues: Array of identified issues
- summary: Brief overall assessment
- overallScore: Quality score from 0-100
- metrics: Optional key metrics (e.g., complexity scores)
- analyzedFiles: List of files analyzed
- timestamp: ISO timestamp
- duration: Placeholder for duration (will be filled by system)`;

export const ANALYSIS_TYPE_INSTRUCTIONS: Record<AnalysisType, string> = {
  full: `Perform a comprehensive analysis covering all issue categories. Be thorough but avoid overwhelming with minor issues - focus on the most impactful findings first.`,

  security: `Focus exclusively on security-related issues:
- SQL injection, XSS, CSRF vulnerabilities
- Authentication and authorization flaws
- Sensitive data exposure
- Insecure dependencies
- Cryptographic weaknesses
- Input validation issues
- Access control problems
- Security misconfigurations`,

  performance: `Focus exclusively on performance-related issues:
- Inefficient algorithms (O(n^2) where O(n) is possible)
- Unnecessary computations or iterations
- Memory leaks and excessive memory usage
- Blocking operations in async contexts
- Missing caching opportunities
- Database query optimization
- Network request optimization
- Bundle size concerns`,

  maintainability: `Focus exclusively on maintainability issues:
- Code complexity and readability
- Function/method length and responsibility
- Class design and SOLID principles
- Coupling and cohesion
- Naming conventions
- Code organization and structure
- Technical debt indicators
- Missing abstractions`,

  bugs: `Focus exclusively on bug detection:
- Logic errors and edge cases
- Null/undefined handling
- Type mismatches
- Race conditions
- Resource leaks
- Error handling gaps
- Incorrect assumptions
- Off-by-one errors`,

  style: `Focus exclusively on code style issues:
- Formatting inconsistencies
- Naming conventions
- Code organization
- Import ordering
- Comment quality
- Whitespace usage
- Line length
- Bracket placement`,

  quick: `Perform a quick scan for only the most critical issues:
- Obvious bugs
- Security vulnerabilities
- Major performance problems
Limit to top 5 most important findings.`,
};

// ============================================================================
// User Prompt Generation
// ============================================================================

export function generateAnalysisUserPrompt(options: AnalysisPromptOptions): string {
  const {
    type,
    files,
    context,
    focusAreas,
    ignorePatterns,
    maxIssues,
    minSeverity,
  } = options;

  const parts: string[] = [];

  // Add type-specific instructions
  parts.push(`## Analysis Type: ${type.toUpperCase()}`);
  parts.push(ANALYSIS_TYPE_INSTRUCTIONS[type]);
  parts.push('');

  // Add context if provided
  if (context) {
    parts.push('## Additional Context');
    parts.push(context);
    parts.push('');
  }

  // Add focus areas
  if (focusAreas && focusAreas.length > 0) {
    parts.push('## Focus Areas');
    parts.push('Pay special attention to:');
    focusAreas.forEach(area => parts.push(`- ${area}`));
    parts.push('');
  }

  // Add ignore patterns
  if (ignorePatterns && ignorePatterns.length > 0) {
    parts.push('## Ignore Patterns');
    parts.push('Do not report issues related to:');
    ignorePatterns.forEach(pattern => parts.push(`- ${pattern}`));
    parts.push('');
  }

  // Add constraints
  if (maxIssues || minSeverity) {
    parts.push('## Constraints');
    if (maxIssues) {
      parts.push(`- Report at most ${maxIssues} issues`);
    }
    if (minSeverity) {
      const severityOrder = ['hint', 'info', 'warning', 'error'];
      const minIndex = severityOrder.indexOf(minSeverity);
      const allowedSeverities = severityOrder.slice(minIndex).join(', ');
      parts.push(`- Only report issues with severity: ${allowedSeverities}`);
    }
    parts.push('');
  }

  // Add files to analyze
  parts.push('## Files to Analyze');
  parts.push('');

  for (const file of files) {
    const language = file.language ?? detectLanguage(file.path);
    parts.push(`### File: ${file.path}`);
    parts.push('```' + language);
    parts.push(file.content);
    parts.push('```');
    parts.push('');
  }

  // Add response format reminder
  parts.push('## Required Response Format');
  parts.push('Respond with a valid JSON object matching this structure:');
  parts.push('```json');
  parts.push(JSON.stringify(ANALYSIS_RESPONSE_TEMPLATE, null, 2));
  parts.push('```');

  return parts.join('\n');
}

// ============================================================================
// Response Template
// ============================================================================

const ANALYSIS_RESPONSE_TEMPLATE = {
  issues: [
    {
      id: 'BUG-A1B2C3D4',
      title: 'Brief issue title',
      description: 'Detailed description of the issue and why it matters',
      severity: 'error|warning|info|hint',
      category: 'bug|security|performance|etc',
      location: {
        file: 'path/to/file.ts',
        startLine: 10,
        endLine: 15,
        startColumn: 5,
        endColumn: 20,
      },
      suggestedFix: 'Brief suggestion for how to fix',
      confidence: 0.95,
      references: ['https://example.com/best-practice'],
      tags: ['tag1', 'tag2'],
    },
  ],
  summary: 'Overall assessment of code quality',
  overallScore: 75,
  metrics: {
    totalIssues: 5,
    errorCount: 1,
    warningCount: 2,
    infoCount: 2,
  },
  analyzedFiles: ['file1.ts', 'file2.ts'],
  timestamp: '2024-01-01T00:00:00.000Z',
  duration: 0,
};

// ============================================================================
// Response Parsing
// ============================================================================

const PartialIssueSchema = z.object({
  id: z.string().optional(),
  title: z.string(),
  description: z.string(),
  severity: z.enum(['error', 'warning', 'info', 'hint']),
  category: z.enum([
    'bug', 'security', 'performance', 'maintainability', 'style',
    'complexity', 'duplication', 'documentation', 'testing',
    'accessibility', 'compatibility', 'other',
  ]),
  location: z.object({
    file: z.string(),
    startLine: z.number(),
    endLine: z.number(),
    startColumn: z.number().optional(),
    endColumn: z.number().optional(),
  }),
  suggestedFix: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  references: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
});

const PartialAnalysisResultSchema = z.object({
  issues: z.array(PartialIssueSchema),
  summary: z.string(),
  overallScore: z.number().min(0).max(100),
  metrics: z.record(z.string(), z.number()).optional(),
  analyzedFiles: z.array(z.string()).optional(),
  timestamp: z.string().optional(),
  duration: z.number().optional(),
});

export function parseAnalysisResponse(
  response: string,
  analyzedFiles: string[],
  startTime: number,
): AnalysisResult {
  // Extract JSON from response (may be wrapped in markdown code blocks)
  let jsonStr = response;

  const codeBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch?.[1]) {
    jsonStr = codeBlockMatch[1].trim();
  }

  // Try to find JSON object
  const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (jsonMatch?.[0]) {
    jsonStr = jsonMatch[0];
  }

  // Parse and validate
  const parsed = JSON.parse(jsonStr);
  const partial = PartialAnalysisResultSchema.parse(parsed);

  // Normalize and complete the result
  const now = new Date().toISOString();
  const duration = Date.now() - startTime;

  const issues: Issue[] = partial.issues.map((issue, index) => ({
    id: issue.id ?? generateIssueId(issue.location.file, issue.location.startLine, issue.category, index),
    title: issue.title,
    description: issue.description,
    severity: issue.severity,
    category: issue.category,
    location: issue.location,
    suggestedFix: issue.suggestedFix,
    confidence: issue.confidence ?? 0.8,
    references: issue.references,
    tags: issue.tags,
  }));

  return {
    issues,
    summary: partial.summary,
    overallScore: partial.overallScore,
    metrics: partial.metrics,
    analyzedFiles: partial.analyzedFiles ?? analyzedFiles,
    timestamp: partial.timestamp ?? now,
    duration: partial.duration ?? duration,
  };
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
    less: 'less',
    md: 'markdown',
    vue: 'vue',
    svelte: 'svelte',
  };
  return languageMap[ext] ?? ext;
}

function generateIssueId(
  file: string,
  line: number,
  category: IssueCategory,
  index: number,
): string {
  const prefix = category.slice(0, 3).toUpperCase();
  const hash = simpleHash(`${file}:${line}:${index}`);
  return `${prefix}-${hash}`;
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).slice(0, 8).toUpperCase();
}

export { detectLanguage };
