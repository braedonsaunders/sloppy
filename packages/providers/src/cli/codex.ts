import { spawn } from 'node:child_process';
import { writeFile, unlink, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BaseProvider,
  ProviderConfig,
  ProviderError,
  TimeoutError,
  AnalysisResult,
  FixResult,
  VerifyResult,
  Issue,
  StreamCallbacks,
} from '../base.js';
import {
  ANALYSIS_SYSTEM_PROMPT,
  generateAnalysisUserPrompt,
  parseAnalysisResponse,
  AnalysisType,
} from '../prompts/analysis.js';
import {
  FIX_SYSTEM_PROMPT,
  generateFixUserPrompt,
  parseFixResponse,
} from '../prompts/fix.js';
import {
  VERIFY_SYSTEM_PROMPT,
  generateVerifyUserPrompt,
  parseVerifyResponse,
} from '../prompts/verify.js';

// ============================================================================
// Types
// ============================================================================

export type CodexModel = string;

export interface CodexCLIConfig extends ProviderConfig {
  cliPath?: string;
  model?: CodexModel;
  analysisType?: AnalysisType;
  workingDirectory?: string;
  approvalMode?: 'suggest' | 'auto-edit' | 'full-auto';
  quietMode?: boolean;
}

interface CLIResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

// ============================================================================
// Codex CLI Provider
// ============================================================================

export class CodexCLIProvider extends BaseProvider {
  private readonly cliPath: string;
  private readonly cliModel: CodexModel;
  private analysisType: AnalysisType;
  private readonly workingDirectory: string | undefined;
  private approvalMode: 'suggest' | 'auto-edit' | 'full-auto';
  private readonly quietMode: boolean;

  constructor(config: CodexCLIConfig = {}) {
    super({
      ...config,
      model: config.model ?? 'o4-mini',
      maxTokens: config.maxTokens ?? 8192,
      timeout: config.timeout ?? 600000, // 10 minutes for CLI operations
      // CLI doesn't have traditional rate limits
      rateLimitRpm: config.rateLimitRpm ?? 100,
      rateLimitTpm: config.rateLimitTpm ?? 500000,
    });

    this.cliPath = config.cliPath ?? 'codex';
    this.cliModel = config.model ?? 'o4-mini';
    this.analysisType = config.analysisType ?? 'full';
    this.workingDirectory = config.workingDirectory;
    this.approvalMode = config.approvalMode ?? 'suggest';
    this.quietMode = config.quietMode ?? true;
  }

  get name(): string {
    return `Codex CLI (${this.cliModel})`;
  }

  // ============================================================================
  // Health Check
  // ============================================================================

  /**
   * Check if Codex CLI is available and working
   */
  async healthCheck(): Promise<{ available: boolean; version?: string; error?: string }> {
    try {
      const result = await this.runCLI(['--version']);
      return {
        available: result.exitCode === 0,
        version: result.stdout.trim(),
      };
    } catch (error) {
      return {
        available: false,
        error: error instanceof Error ? error.message : 'CLI not found',
      };
    }
  }

  // ============================================================================
  // Code Analysis
  // ============================================================================

  async analyzeCode(
    files: string[],
    context: string,
    callbacks?: StreamCallbacks,
  ): Promise<AnalysisResult> {
    const startTime = Date.now();

    const fileContents = files.map(filePath => ({
      path: filePath,
      content: `// Content of ${filePath} would be read here`,
      language: this.detectLanguage(filePath),
    }));

    const prompt = this.buildFullPrompt(
      ANALYSIS_SYSTEM_PROMPT,
      generateAnalysisUserPrompt({
        type: this.analysisType,
        files: fileContents,
        context,
      }),
    );

    const response = await this.executePrompt(prompt, callbacks);
    return parseAnalysisResponse(response, files, startTime);
  }

  /**
   * Analyze code with explicit file contents
   */
  async analyzeCodeWithContents(
    files: { path: string; content: string }[],
    context: string,
    callbacks?: StreamCallbacks,
  ): Promise<AnalysisResult> {
    const startTime = Date.now();

    const fileContents = files.map(f => ({
      ...f,
      language: this.detectLanguage(f.path),
    }));

    const prompt = this.buildFullPrompt(
      ANALYSIS_SYSTEM_PROMPT,
      generateAnalysisUserPrompt({
        type: this.analysisType,
        files: fileContents,
        context,
      }),
    );

    const response = await this.executePrompt(prompt, callbacks);
    return parseAnalysisResponse(response, files.map(f => f.path), startTime);
  }

  // ============================================================================
  // Issue Fixing
  // ============================================================================

  async fixIssue(
    issue: Issue,
    fileContent: string,
    callbacks?: StreamCallbacks,
  ): Promise<FixResult> {
    const prompt = this.buildFullPrompt(
      FIX_SYSTEM_PROMPT,
      generateFixUserPrompt({
        issue,
        fileContent,
        filePath: issue.location.file,
      }),
    );

    const response = await this.executePrompt(prompt, callbacks);
    return parseFixResponse(response);
  }

  // ============================================================================
  // Fix Verification
  // ============================================================================

  async verifyFix(
    issue: Issue,
    diff: string,
    fileContent: string,
    callbacks?: StreamCallbacks,
  ): Promise<VerifyResult> {
    const newContent = this.applySimpleDiff(fileContent, diff);

    const prompt = this.buildFullPrompt(
      VERIFY_SYSTEM_PROMPT,
      generateVerifyUserPrompt({
        issue,
        diff,
        originalContent: fileContent,
        newContent,
        filePath: issue.location.file,
      }),
    );

    const response = await this.executePrompt(prompt, callbacks);
    return parseVerifyResponse(response);
  }

  // ============================================================================
  // CLI Execution
  // ============================================================================

  private buildFullPrompt(systemPrompt: string, userPrompt: string): string {
    return `${systemPrompt}\n\n---\n\n${userPrompt}`;
  }

  private async executePrompt(
    prompt: string,
    callbacks?: StreamCallbacks,
  ): Promise<string> {
    // Write prompt to temp file
    let promptFile: string | undefined;
    let tempDir: string | undefined;

    try {
      tempDir = await mkdtemp(join(tmpdir(), 'sloppy-codex-'));
      promptFile = join(tempDir, 'prompt.txt');
      await writeFile(promptFile, prompt, 'utf-8');

      const args = this.buildCLIArgs(promptFile);

      if (callbacks?.onToken) {
        return await this.runCLIStreaming(args, callbacks);
      }

      const result = await this.runCLI(args);

      if (result.exitCode !== 0) {
        throw new ProviderError(
          `CLI exited with code ${String(result.exitCode)}: ${result.stderr}`,
          'CLI_ERROR',
          false,
          result.exitCode,
        );
      }

      return this.extractResponse(result.stdout);
    } finally {
      // Cleanup temp files
      if (promptFile !== undefined) {
        try {
          await unlink(promptFile);
        } catch {
          // Ignore cleanup errors
        }
      }
      if (tempDir !== undefined) {
        try {
          await unlink(tempDir);
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  }

  private buildCLIArgs(promptFile: string): string[] {
    const args: string[] = [];

    // Model selection
    args.push('--model', this.cliModel);

    // Approval mode
    args.push('--approval-mode', this.approvalMode);

    // Quiet mode for programmatic use
    if (this.quietMode) {
      args.push('--quiet');
    }

    // Read prompt from file
    args.push('--prompt-file', promptFile);

    return args;
  }

  private async runCLI(args: string[]): Promise<CLIResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.cliPath, args, {
        cwd: this.workingDirectory,
        env: process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const timeoutId = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, this.config.timeout);

      child.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        clearTimeout(timeoutId);

        if (timedOut) {
          reject(new TimeoutError(`CLI timed out after ${String(this.config.timeout)}ms`));
          return;
        }

        resolve({
          stdout,
          stderr,
          exitCode: code ?? 1,
        });
      });

      child.on('error', (error) => {
        clearTimeout(timeoutId);
        reject(new ProviderError(
          `Failed to spawn CLI: ${error.message}`,
          'CLI_SPAWN_ERROR',
          false,
          undefined,
          error,
        ));
      });

      child.stdin.end();
    });
  }

  private async runCLIStreaming(
    args: string[],
    callbacks: StreamCallbacks,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.cliPath, args, {
        cwd: this.workingDirectory,
        env: process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let fullContent = '';
      let stderr = '';
      let timedOut = false;
      let chunkCount = 0;

      const timeoutId = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, this.config.timeout);

      child.stdout.on('data', (data: Buffer) => {
        const text = data.toString();
        fullContent += text;
        callbacks.onToken?.(text);
        chunkCount++;
        callbacks.onProgress?.(Math.min(0.99, chunkCount / 200));
      });

      child.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        clearTimeout(timeoutId);
        callbacks.onProgress?.(1);

        if (timedOut) {
          callbacks.onError?.(new TimeoutError(`CLI timed out after ${String(this.config.timeout)}ms`));
          reject(new TimeoutError(`CLI timed out after ${String(this.config.timeout)}ms`));
          return;
        }

        if (code !== 0) {
          const error = new ProviderError(
            `CLI exited with code ${String(code)}: ${stderr}`,
            'CLI_ERROR',
            false,
            code ?? undefined,
          );
          callbacks.onError?.(error);
          reject(error);
          return;
        }

        resolve(fullContent);
      });

      child.on('error', (error) => {
        clearTimeout(timeoutId);
        const providerError = new ProviderError(
          `Failed to spawn CLI: ${error.message}`,
          'CLI_SPAWN_ERROR',
          false,
          undefined,
          error,
        );
        callbacks.onError?.(providerError);
        reject(providerError);
      });

      child.stdin.end();
    });
  }

  private extractResponse(output: string): string {
    // Codex CLI may output in various formats
    // Try to extract JSON response if present
    const jsonMatch = /```(?:json)?\s*([\s\S]*?)```/.exec(output);
    const jsonContent = jsonMatch?.[1];
    if (jsonContent !== undefined && jsonContent !== '') {
      return jsonContent.trim();
    }

    // Look for JSON object in output
    const objectMatch = /\{[\s\S]*\}/.exec(output);
    const objectContent = objectMatch?.[0];
    if (objectContent !== undefined && objectContent !== '') {
      try {
        JSON.parse(objectContent);
        return objectContent;
      } catch {
        // Not valid JSON
      }
    }

    return output;
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  private detectLanguage(filePath: string): string {
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

  private applySimpleDiff(content: string, diff: string): string {
    const lines = content.split('\n');
    const result = [...lines];

    const hunkRegex = /@@ -(\d+),?\d* \+(\d+),?\d* @@/g;
    let match;
    let offset = 0;

    while ((match = hunkRegex.exec(diff)) !== null) {
      const originalStart = parseInt(match[1], 10) - 1;
      const hunkStart = match.index;
      const nextHunk = diff.indexOf('@@', hunkStart + match[0].length);
      const hunkContent = nextHunk === -1
        ? diff.slice(hunkStart + match[0].length)
        : diff.slice(hunkStart + match[0].length, nextHunk);

      const hunkLines = hunkContent.split('\n').filter(l => l.length > 0);
      let currentLine = originalStart + offset;

      for (const line of hunkLines) {
        if (line.startsWith('-')) {
          result.splice(currentLine, 1);
          offset--;
        } else if (line.startsWith('+')) {
          result.splice(currentLine, 0, line.slice(1));
          currentLine++;
          offset++;
        } else if (line.startsWith(' ')) {
          currentLine++;
        }
      }
    }

    return result.join('\n');
  }

  /**
   * Set the analysis type for subsequent analyses
   */
  setAnalysisType(type: AnalysisType): void {
    this.analysisType = type;
  }

  /**
   * Run Codex with auto-edit mode for automatic fixes
   */
  async autoFix(
    issue: Issue,
    fileContent: string,
    callbacks?: StreamCallbacks,
  ): Promise<FixResult> {
    // Temporarily switch to auto-edit mode
    const originalMode = this.approvalMode;
    this.approvalMode = 'auto-edit';

    try {
      return await this.fixIssue(issue, fileContent, callbacks);
    } finally {
      this.approvalMode = originalMode;
    }
  }
}

export default CodexCLIProvider;
