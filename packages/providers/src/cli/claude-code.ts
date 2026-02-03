import { spawn, ChildProcess } from 'node:child_process';
import { writeFile, unlink, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BaseProvider,
  ProviderConfig,
  ProviderError,
  TimeoutError,
  InvalidResponseError,
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

export interface ClaudeCodeCLIConfig extends ProviderConfig {
  cliPath?: string;
  analysisType?: AnalysisType;
  workingDirectory?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  maxTurns?: number;
  outputFormat?: 'text' | 'json' | 'stream-json';
}

interface CLIResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

// ============================================================================
// Claude Code CLI Provider
// ============================================================================

export class ClaudeCodeCLIProvider extends BaseProvider {
  private readonly cliPath: string;
  private analysisType: AnalysisType;
  private readonly workingDirectory: string | undefined;
  private readonly allowedTools: string[];
  private readonly disallowedTools: string[];
  private readonly maxTurns: number;
  private readonly outputFormat: 'text' | 'json' | 'stream-json';

  constructor(config: ClaudeCodeCLIConfig = {}) {
    super({
      ...config,
      model: config.model ?? 'claude-sonnet-4-20250514',
      maxTokens: config.maxTokens ?? 8192,
      timeout: config.timeout ?? 600000, // 10 minutes for CLI operations
      // CLI doesn't have traditional rate limits
      rateLimitRpm: config.rateLimitRpm ?? 100,
      rateLimitTpm: config.rateLimitTpm ?? 500000,
    });

    this.cliPath = config.cliPath ?? 'claude';
    this.analysisType = config.analysisType ?? 'full';
    this.workingDirectory = config.workingDirectory;
    this.allowedTools = config.allowedTools ?? [];
    this.disallowedTools = config.disallowedTools ?? [];
    this.maxTurns = config.maxTurns ?? 10;
    this.outputFormat = config.outputFormat ?? 'json';
  }

  get name(): string {
    return 'Claude Code CLI';
  }

  // ============================================================================
  // Health Check
  // ============================================================================

  /**
   * Check if Claude CLI is available and working
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
    files: Array<{ path: string; content: string }>,
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
    // Write prompt to temp file if it's large
    const useFile = prompt.length > 10000;
    let promptFile: string | undefined;
    let tempDir: string | undefined;

    try {
      const args = this.buildCLIArgs();

      if (useFile) {
        tempDir = await mkdtemp(join(tmpdir(), 'sloppy-claude-'));
        promptFile = join(tempDir, 'prompt.txt');
        await writeFile(promptFile, prompt, 'utf-8');
        args.push('--input-file', promptFile);
      } else {
        args.push('--prompt', prompt);
      }

      if (callbacks?.onToken) {
        return await this.runCLIStreaming(args, callbacks);
      }

      const result = await this.runCLI(args, useFile ? undefined : prompt);

      if (result.exitCode !== 0) {
        throw new ProviderError(
          `CLI exited with code ${result.exitCode}: ${result.stderr}`,
          'CLI_ERROR',
          false,
          result.exitCode,
        );
      }

      return this.extractResponse(result.stdout);
    } finally {
      // Cleanup temp files
      if (promptFile) {
        try {
          await unlink(promptFile);
        } catch {
          // Ignore cleanup errors
        }
      }
      if (tempDir) {
        try {
          await unlink(tempDir);
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  }

  private buildCLIArgs(): string[] {
    const args: string[] = [];

    // Output format
    args.push('--output-format', this.outputFormat);

    // Max turns
    args.push('--max-turns', String(this.maxTurns));

    // Model selection (if supported by CLI)
    if (this.config.model) {
      args.push('--model', this.config.model);
    }

    // Tool allowlist/denylist
    for (const tool of this.allowedTools) {
      args.push('--allowedTools', tool);
    }
    for (const tool of this.disallowedTools) {
      args.push('--disallowedTools', tool);
    }

    // Non-interactive mode
    args.push('--print');

    return args;
  }

  private async runCLI(
    args: string[],
    stdinInput?: string,
  ): Promise<CLIResult> {
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
          reject(new TimeoutError(`CLI timed out after ${this.config.timeout}ms`));
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

      // Write to stdin if provided
      if (stdinInput) {
        child.stdin.write(stdinInput);
        child.stdin.end();
      } else {
        child.stdin.end();
      }
    });
  }

  private async runCLIStreaming(
    args: string[],
    callbacks: StreamCallbacks,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      // Force streaming output format
      const streamArgs = args.filter(a => a !== '--output-format' && a !== 'json' && a !== 'text');
      streamArgs.push('--output-format', 'stream-json');

      const child = spawn(this.cliPath, streamArgs, {
        cwd: this.workingDirectory,
        env: process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let fullContent = '';
      let stderr = '';
      let timedOut = false;

      const timeoutId = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, this.config.timeout);

      child.stdout.on('data', (data: Buffer) => {
        const text = data.toString();

        // Parse streaming JSON events
        const lines = text.split('\n').filter(l => l.trim());
        for (const line of lines) {
          try {
            const event = JSON.parse(line) as {
              type: string;
              content?: string;
              text?: string;
            };

            if (event.type === 'content' || event.type === 'text') {
              const content = event.content ?? event.text ?? '';
              fullContent += content;
              callbacks.onToken?.(content);
            }
          } catch {
            // Not JSON, treat as raw output
            fullContent += line;
            callbacks.onToken?.(line);
          }
        }
      });

      child.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        clearTimeout(timeoutId);
        callbacks.onProgress?.(1);

        if (timedOut) {
          callbacks.onError?.(new TimeoutError(`CLI timed out after ${this.config.timeout}ms`));
          reject(new TimeoutError(`CLI timed out after ${this.config.timeout}ms`));
          return;
        }

        if (code !== 0) {
          const error = new ProviderError(
            `CLI exited with code ${code}: ${stderr}`,
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
    // If JSON output, parse and extract the response
    if (this.outputFormat === 'json') {
      try {
        const parsed = JSON.parse(output) as {
          result?: string;
          response?: string;
          content?: string;
          message?: string;
        };
        return parsed.result ?? parsed.response ?? parsed.content ?? parsed.message ?? output;
      } catch {
        // Not JSON, return raw output
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
      const originalStart = parseInt(match[1] ?? '1', 10) - 1;
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
}

export default ClaudeCodeCLIProvider;
