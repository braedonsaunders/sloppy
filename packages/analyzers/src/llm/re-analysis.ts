/**
 * Re-Analysis Loop
 *
 * After a fix is applied, re-analyzes the code to:
 * 1. Verify the fix addressed the original issue
 * 2. Check for any new issues introduced
 * 3. Ensure overall code quality improved
 */

import * as fs from 'node:fs';
import type { Issue } from '../base.js';
import { ToolExecutor } from './tool-executor.js';
import { generateReAnalysisPrompt, mapToIssueCategory, mapToSeverity } from './prompts.js';

/**
 * Configuration for re-analysis
 */
export interface ReAnalysisConfig {
  /** API key for the LLM provider */
  apiKey?: string;
  /** LLM model to use */
  model?: string;
  /** LLM provider */
  provider?: 'anthropic' | 'openai';
  /** Base URL for the LLM API */
  baseUrl?: string;
  /** Maximum tokens for response */
  maxTokens?: number;
  /** Whether to run tests after fix */
  runTests?: boolean;
  /** Whether to run linting after fix */
  runLint?: boolean;
  /** Whether to run type checking after fix */
  runTypeCheck?: boolean;
  /** Whether to run build after fix */
  runBuild?: boolean;
  /** Maximum re-analysis iterations per issue */
  maxIterations?: number;
}

/**
 * Result of re-analyzing a fix
 */
export interface ReAnalysisResult {
  /** Whether the original issue was resolved */
  issueResolved: boolean;
  /** Assessment of the fix */
  assessment: string;
  /** New issues introduced by the fix */
  newIssues: Issue[];
  /** Any remaining concerns */
  concerns: string[];
  /** Verification results (tests, lint, etc.) */
  verification: {
    tests?: { passed: boolean; output: string };
    lint?: { passed: boolean; errors: number; warnings: number };
    typeCheck?: { passed: boolean; errors: number };
    build?: { passed: boolean; output: string };
  };
  /** Overall pass/fail */
  success: boolean;
}

/**
 * Result of the full analysis loop
 */
export interface AnalysisLoopResult {
  /** Issues found across all iterations */
  allIssues: Issue[];
  /** Issues that were resolved */
  resolvedIssues: Issue[];
  /** Issues that failed to be resolved */
  failedIssues: Issue[];
  /** Number of iterations performed */
  iterations: number;
  /** Whether the codebase is now clean */
  isClean: boolean;
  /** Summary of the analysis */
  summary: string;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Required<ReAnalysisConfig> = {
  apiKey: '',
  model: 'claude-sonnet-4-20250514',
  provider: 'anthropic',
  baseUrl: '',
  maxTokens: 4096,
  runTests: true,
  runLint: true,
  runTypeCheck: true,
  runBuild: false,
  maxIterations: 3,
};

/**
 * Re-Analysis system prompt
 */
const RE_ANALYSIS_SYSTEM_PROMPT = `You are a code review expert verifying that a fix correctly addresses an issue.

Analyze the provided code and determine:
1. Does the fix resolve the original issue?
2. Are there any new issues introduced by the fix?
3. Are there any remaining concerns about this code?

Be thorough but fair - minor style changes are acceptable.

Respond with JSON:
{
  "originalIssueResolved": true|false,
  "resolutionAssessment": "Explanation of whether and how the fix addresses the issue",
  "newIssues": [
    {
      "type": "bug|security|lint|type|stub|duplicate|dead-code|coverage",
      "severity": "error|warning|info|hint",
      "title": "Brief title",
      "description": "Description",
      "lineStart": 10,
      "lineEnd": 12,
      "suggestedFix": "How to fix"
    }
  ],
  "remainingConcerns": ["Any concerns about the code"]
}`;

/**
 * Re-Analysis Loop for verifying fixes
 */
export class ReAnalysisLoop {
  private readonly config: Required<ReAnalysisConfig>;
  private readonly rootDir: string;
  private readonly toolExecutor: ToolExecutor;

  constructor(rootDir: string, config: ReAnalysisConfig = {}) {
    this.rootDir = rootDir;
    this.config = {
      ...DEFAULT_CONFIG,
      apiKey: config.apiKey ?? process.env.ANTHROPIC_API_KEY ?? process.env.OPENAI_API_KEY ?? '',
      ...config,
    };
    this.toolExecutor = new ToolExecutor(rootDir);
  }

  /**
   * Re-analyze a file after a fix was applied
   */
  async reAnalyze(
    originalIssue: Issue,
    fixedFilePath: string,
    appliedFix: string
  ): Promise<ReAnalysisResult> {
    const result: ReAnalysisResult = {
      issueResolved: false,
      assessment: '',
      newIssues: [],
      concerns: [],
      verification: {},
      success: false,
    };

    try {
      // Read the fixed file
      const fileContent = await fs.promises.readFile(fixedFilePath, 'utf-8');

      // Run verification tools first
      if (this.config.runLint) {
        const lintResult = await this.toolExecutor.runESLint([fixedFilePath]);
        result.verification.lint = {
          passed: lintResult.result.length === 0,
          errors: lintResult.result.filter(i => i.severity === 'error').length,
          warnings: lintResult.result.filter(i => i.severity === 'warning').length,
        };
      }

      if (this.config.runTypeCheck) {
        const typeResult = await this.toolExecutor.runTypeCheck([fixedFilePath]);
        result.verification.typeCheck = {
          passed: typeResult.result.length === 0,
          errors: typeResult.result.length,
        };
      }

      if (this.config.runTests) {
        const testResult = await this.toolExecutor.runTests();
        result.verification.tests = {
          passed: testResult.result.failed === 0,
          output: testResult.output,
        };
      }

      if (this.config.runBuild) {
        const buildResult = await this.toolExecutor.runBuild();
        result.verification.build = {
          passed: buildResult.result.success,
          output: buildResult.output,
        };
      }

      // Ask LLM to verify the fix
      if (this.config.apiKey) {
        const llmResult = await this.askLLMToVerify(
          originalIssue,
          fixedFilePath,
          fileContent,
          appliedFix
        );

        result.issueResolved = llmResult.issueResolved;
        result.assessment = llmResult.assessment;
        result.newIssues = llmResult.newIssues;
        result.concerns = llmResult.concerns;
      } else {
        // Without LLM, rely on tool verification
        result.issueResolved = this.allVerificationsPassed(result.verification);
        result.assessment = 'Verified by running tools (no LLM verification)';
      }

      // Determine overall success
      result.success = result.issueResolved &&
        this.allVerificationsPassed(result.verification) &&
        result.newIssues.filter(i => i.severity === 'error').length === 0;

    } catch (error) {
      result.assessment = `Re-analysis failed: ${error instanceof Error ? error.message : String(error)}`;
      result.success = false;
    }

    return result;
  }

  /**
   * Run a full analysis loop: analyze -> fix -> re-analyze -> repeat
   */
  async runAnalysisLoop(
    issues: Issue[],
    fixCallback: (issue: Issue) => Promise<{ fixApplied: boolean; fix: string } | null>,
    options?: { maxIterations?: number; stopOnClean?: boolean }
  ): Promise<AnalysisLoopResult> {
    const maxIterations = options?.maxIterations ?? this.config.maxIterations;
    const stopOnClean = options?.stopOnClean ?? true;

    const result: AnalysisLoopResult = {
      allIssues: [...issues],
      resolvedIssues: [],
      failedIssues: [],
      iterations: 0,
      isClean: false,
      summary: '',
    };

    let currentIssues = [...issues];

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      result.iterations = iteration + 1;

      if (currentIssues.length === 0) {
        result.isClean = true;
        break;
      }

      console.warn(`[Re-Analysis] Iteration ${String(iteration + 1)}: ${String(currentIssues.length)} issues to process`);

      const newIssues: Issue[] = [];
      const resolvedInIteration: Issue[] = [];
      const failedInIteration: Issue[] = [];

      for (const issue of currentIssues) {
        // Try to fix the issue
        const fixResult = await fixCallback(issue);

        if (fixResult?.fixApplied !== true) {
          failedInIteration.push(issue);
          continue;
        }

        // Re-analyze the fix
        const reAnalysis = await this.reAnalyze(
          issue,
          issue.location.file,
          fixResult.fix
        );

        if (reAnalysis.success) {
          resolvedInIteration.push(issue);
        } else {
          failedInIteration.push(issue);
        }

        // Collect new issues
        newIssues.push(...reAnalysis.newIssues);
      }

      // Update tracking
      result.resolvedIssues.push(...resolvedInIteration);
      result.failedIssues = failedInIteration;
      result.allIssues.push(...newIssues);

      // Update current issues for next iteration
      currentIssues = [...failedInIteration, ...newIssues];

      if (stopOnClean && currentIssues.length === 0) {
        result.isClean = true;
        break;
      }
    }

    // Generate summary
    result.summary = this.generateSummary(result);

    return result;
  }

  /**
   * Ask LLM to verify the fix
   */
  private async askLLMToVerify(
    originalIssue: Issue,
    filePath: string,
    fileContent: string,
    appliedFix: string
  ): Promise<{
    issueResolved: boolean;
    assessment: string;
    newIssues: Issue[];
    concerns: string[];
  }> {
    const prompt = generateReAnalysisPrompt(
      { path: filePath, content: fileContent },
      {
        description: originalIssue.description ?? originalIssue.message,
        lineStart: originalIssue.location.line,
        lineEnd: originalIssue.location.endLine ?? originalIssue.location.line,
      },
      appliedFix
    );

    try {
      const response = await this.callLLM(RE_ANALYSIS_SYSTEM_PROMPT, prompt);

      // Parse JSON response
      const jsonMatch = /\{[\s\S]*\}/.exec(response);
      if (!jsonMatch) {
        return {
          issueResolved: false,
          assessment: 'Could not parse LLM response',
          newIssues: [],
          concerns: [],
        };
      }

      const parsed = JSON.parse(jsonMatch[0]) as {
        originalIssueResolved: boolean;
        resolutionAssessment: string;
        newIssues: {
          type: string;
          severity: string;
          title: string;
          description: string;
          lineStart: number;
          lineEnd: number;
          suggestedFix?: string;
        }[];
        remainingConcerns: string[];
      };

      // Convert new issues to Issue format
      const newIssues: Issue[] = parsed.newIssues.map((i, idx) => ({
        id: `reanalysis-${String(Date.now())}-${String(idx)}`,
        category: mapToIssueCategory(i.type),
        severity: mapToSeverity(i.severity),
        message: i.title,
        description: i.description,
        location: {
          file: filePath,
          line: i.lineStart,
          column: 1,
          endLine: i.lineEnd,
        },
        suggestion: i.suggestedFix,
      }));

      return {
        issueResolved: parsed.originalIssueResolved,
        assessment: parsed.resolutionAssessment,
        newIssues,
        concerns: parsed.remainingConcerns,
      };
    } catch (error) {
      return {
        issueResolved: false,
        assessment: `LLM verification failed: ${error instanceof Error ? error.message : String(error)}`,
        newIssues: [],
        concerns: [],
      };
    }
  }

  /**
   * Call the LLM
   */
  private async callLLM(systemPrompt: string, userPrompt: string): Promise<string> {
    if (this.config.provider === 'anthropic') {
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      const client = new Anthropic({
        apiKey: this.config.apiKey,
        baseURL: this.config.baseUrl || undefined,
      });

      const response = await client.messages.create({
        model: this.config.model,
        max_tokens: this.config.maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      });

      const textBlock = response.content.find((b: { type: string }) => b.type === 'text');
      return (textBlock as { type: 'text'; text: string } | undefined)?.text ?? '';
    } else {
      const { default: OpenAI } = await import('openai');
      const client = new OpenAI({
        apiKey: this.config.apiKey,
        baseURL: this.config.baseUrl || undefined,
      });

      const response = await client.chat.completions.create({
        model: this.config.model,
        max_tokens: this.config.maxTokens,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      });

      return response.choices[0]?.message?.content ?? '';
    }
  }

  /**
   * Check if all verifications passed
   */
  private allVerificationsPassed(verification: ReAnalysisResult['verification']): boolean {
    if (verification.tests && !verification.tests.passed) {return false;}
    if (verification.lint && !verification.lint.passed) {return false;}
    if (verification.typeCheck && !verification.typeCheck.passed) {return false;}
    if (verification.build && !verification.build.passed) {return false;}
    return true;
  }

  /**
   * Generate summary of the analysis loop
   */
  private generateSummary(result: AnalysisLoopResult): string {
    const parts: string[] = [];

    parts.push(`Analysis Loop completed after ${String(result.iterations)} iteration(s).`);
    parts.push(`Total issues found: ${String(result.allIssues.length)}`);
    parts.push(`Issues resolved: ${String(result.resolvedIssues.length)}`);
    parts.push(`Issues remaining: ${String(result.failedIssues.length)}`);

    if (result.isClean) {
      parts.push('✓ Codebase is clean!');
    } else {
      parts.push('⚠ Some issues remain unresolved.');
    }

    return parts.join('\n');
  }
}

/**
 * Create a simple re-analysis runner
 */
export function createReAnalysisRunner(
  rootDir: string,
  config?: ReAnalysisConfig
): ReAnalysisLoop {
  return new ReAnalysisLoop(rootDir, config);
}
