import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AgentType } from './types';

export async function installAgent(agent: AgentType): Promise<void> {
  if (agent === 'claude') {
    // @anthropic-ai/claude-agent-sdk provides the SDK query() function for streaming.
    // @anthropic-ai/claude-code provides the CLI binary for the fallback path.
    await exec.exec('npm', ['install', '-g', '@anthropic-ai/claude-agent-sdk', '@anthropic-ai/claude-code']);
  } else {
    await exec.exec('npm', ['install', '-g', '@openai/codex']);
  }
}

// Runner script executed in a separate Node.js process to use the SDK.
// This gives us real-time streaming events via stdout JSONL, bypassing
// the CLI's -p mode which buffers all output until completion.
//
// IMPORTANT: The SDK packages are ESM-only (sdk.mjs entry point), so this
// runner must be saved as .mjs and use dynamic import(). Additionally,
// NODE_PATH only works with require(), not import(), so we manually resolve
// the package path from the global npm root when bare imports fail.
const CLAUDE_RUNNER = `
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

async function loadQuery() {
  const globalRoot = process.env.NODE_PATH || '';
  const packages = ['@anthropic-ai/claude-agent-sdk', '@anthropic-ai/claude-code'];

  for (const pkg of packages) {
    // Try bare specifier (works if in local node_modules)
    try {
      const mod = await import(pkg);
      if (mod.query) return mod.query;
    } catch {}

    // Try loading from global npm root via file URL
    // (bare import always fails for globally-installed ESM packages)
    if (globalRoot) {
      try {
        const pkgDir = path.join(globalRoot, pkg);
        const pkgJsonPath = path.join(pkgDir, 'package.json');
        const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
        let entry = pkgJson.exports?.['.'];
        if (typeof entry === 'object') entry = entry.import || entry.default;
        if (!entry) entry = pkgJson.main || 'index.js';
        const fullPath = path.resolve(pkgDir, entry);
        const mod = await import(pathToFileURL(fullPath).href);
        if (mod.query) return mod.query;
      } catch (e) {
        process.stderr.write(pkg + ': ' + (e.code || e.message) + '\\n');
      }
    }
  }
  return null;
}

const prompt = fs.readFileSync(process.argv[2], 'utf-8');
const opts = JSON.parse(process.argv[3]);

const query = await loadQuery();
if (!query) {
  process.stderr.write('SDK_NOT_FOUND\\n');
  process.exit(2);
}

const controller = new AbortController();
if (opts.timeout > 0) {
  setTimeout(() => controller.abort(), opts.timeout);
}

try {
  for await (const msg of query({
    prompt,
    options: {
      maxTurns: opts.maxTurns || undefined,
      model: opts.model || undefined,
      permissionMode: 'bypassPermissions',
      abortController: controller,
    },
  })) {
    process.stdout.write(JSON.stringify(msg) + '\\n');
  }
} catch (err) {
  if (err.name === 'AbortError') {
    process.stderr.write('TIMEOUT\\n');
    process.exit(1);
  }
  process.stderr.write((err.message || String(err)) + '\\n');
  process.exit(1);
}
`;

export async function runAgent(
  agent: AgentType,
  prompt: string,
  options?: {
    maxTurns?: number;
    model?: string;
    timeout?: number;
    verbose?: boolean;
    cwd?: string;
  },
): Promise<{ output: string; exitCode: number }> {
  if (agent === 'claude') {
    const result = await runClaudeSDK(prompt, options);
    // Exit code 2 = SDK not found, fall back to CLI
    if (result.exitCode === 2) {
      core.warning('Claude SDK query() not available, falling back to CLI (no streaming)');
      return runClaudeCLI(prompt, options);
    }
    return result;
  }

  // Codex: CLI only
  return runCLI('codex', ['exec', '--full-auto', '--quiet', prompt], options);
}

async function runClaudeSDK(
  prompt: string,
  options?: { maxTurns?: number; model?: string; timeout?: number; verbose?: boolean; cwd?: string },
): Promise<{ output: string; exitCode: number }> {
  const verbose = options?.verbose ?? false;
  const execStart = Date.now();
  let agentResult = '';
  let lineBuffer = '';
  let eventCount = 0;
  let firstChunk = true;
  let stderr = '';

  // Write runner script and prompt to temp files
  const tmpDir = os.tmpdir();
  const ts = Date.now();
  const scriptPath = path.join(tmpDir, `sloppy-runner-${ts}.mjs`);
  const promptPath = path.join(tmpDir, `sloppy-prompt-${ts}.txt`);
  fs.writeFileSync(scriptPath, CLAUDE_RUNNER);
  fs.writeFileSync(promptPath, prompt);

  const opts = JSON.stringify({
    maxTurns: options?.maxTurns || 0,
    model: options?.model || '',
    timeout: options?.timeout || 0,
  });

  // Find global module path so the runner script can require the SDK
  let globalRoot = '';
  await exec.exec('npm', ['root', '-g'], {
    listeners: { stdout: (d: Buffer) => { globalRoot += d.toString().trim(); } },
    silent: true,
  });

  const processLine = (line: string): void => {
    const trimmed = line.trim();
    if (!trimmed) return;

    try {
      const event = JSON.parse(trimmed);
      eventCount++;

      if (event.type === 'result') {
        agentResult = event.result || '';
      }

      if (verbose) {
        if (event.type === 'assistant' && event.message?.content) {
          for (const block of event.message.content) {
            if (block.type === 'text' && block.text) {
              const preview = block.text.length > 300
                ? block.text.slice(0, 300) + '...'
                : block.text;
              for (const textLine of preview.split('\n')) {
                if (textLine.trim()) core.info(`  | ${textLine}`);
              }
            } else if (block.type === 'tool_use') {
              core.info(`  | [tool: ${block.name}]`);
            }
          }
        } else if (event.type === 'system') {
          core.info(`  | [system: ${event.subtype || 'init'}]`);
        }
      }
    } catch {
      if (verbose) core.info(`  | ${trimmed.slice(0, 300)}`);
    }
  };

  // Heartbeat: log periodically so the user knows the agent is alive
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  if (verbose) {
    heartbeat = setInterval(() => {
      const elapsed = Math.round((Date.now() - execStart) / 1000);
      core.info(`  ... agent running (${elapsed}s, ${eventCount} events)`);
    }, 30_000);
  }

  const execOptions: exec.ExecOptions = {
    listeners: {
      stdout: (data: Buffer) => {
        const chunk = data.toString();

        if (firstChunk && verbose) {
          firstChunk = false;
          const elapsed = Math.round((Date.now() - execStart) / 1000);
          core.info(`  [stream] First output after ${elapsed}s (${chunk.length} bytes)`);
        }

        lineBuffer += chunk;
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop() || '';
        for (const line of lines) processLine(line);
      },
      stderr: (data: Buffer) => {
        const chunk = data.toString();
        stderr += chunk;
        if (verbose) {
          for (const line of chunk.split('\n')) {
            const trimmed = line.trim();
            if (trimmed) core.info(`  |err| ${trimmed}`);
          }
        }
      },
    },
    ignoreReturnCode: true,
    silent: true,
    cwd: options?.cwd || undefined,
    env: {
      ...process.env,
      NODE_PATH: globalRoot,
      // Strip all whitespace from auth tokens — GitHub Actions secrets often
      // include embedded or trailing newlines which cause "Headers.append:
      // invalid header value" errors when the SDK sets Authorization headers.
      ...(process.env.ANTHROPIC_API_KEY && {
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY.replace(/\s/g, ''),
      }),
      ...(process.env.CLAUDE_CODE_OAUTH_TOKEN && {
        CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN.replace(/\s/g, ''),
      }),
    } as Record<string, string>,
  };

  let exitCode: number;
  try {
    // Safety timeout in parent (+30s buffer so the runner's internal abort fires first)
    const parentTimeout = options?.timeout ? options.timeout + 30_000 : undefined;
    exitCode = await execWithTimeout('node', [scriptPath, promptPath, opts], execOptions, parentTimeout);
    if (lineBuffer.trim()) processLine(lineBuffer);
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    try { fs.unlinkSync(scriptPath); } catch {}
    try { fs.unlinkSync(promptPath); } catch {}
  }

  if (verbose) {
    const elapsed = Math.round((Date.now() - execStart) / 1000);
    core.info(`  [stream] Agent finished in ${elapsed}s (${eventCount} events)`);
  }

  if (stderr && exitCode !== 0) {
    core.warning(`Agent stderr: ${stderr.slice(0, 500)}`);
  }

  return { output: agentResult, exitCode };
}

// CLI fallback for claude (--output-format json, no streaming)
async function runClaudeCLI(
  prompt: string,
  options?: { maxTurns?: number; model?: string; timeout?: number; verbose?: boolean; cwd?: string },
): Promise<{ output: string; exitCode: number }> {
  const args = ['-p', prompt, '--output-format', 'json', '--dangerously-skip-permissions'];
  if (options?.maxTurns) args.push('--max-turns', String(options.maxTurns));
  if (options?.model) args.push('--model', options.model);
  return runCLI('claude', args, options);
}

// Generic CLI runner with heartbeat and timeout
async function runCLI(
  cmd: string,
  args: string[],
  options?: { timeout?: number; verbose?: boolean; cwd?: string },
): Promise<{ output: string; exitCode: number }> {
  let stdout = '';
  let stderr = '';
  const verbose = options?.verbose ?? false;
  const execStart = Date.now();

  let heartbeat: ReturnType<typeof setInterval> | undefined;
  if (verbose) {
    heartbeat = setInterval(() => {
      const elapsed = Math.round((Date.now() - execStart) / 1000);
      core.info(`  ... agent running (${elapsed}s, stdout: ${stdout.length} bytes)`);
    }, 30_000);
  }

  const execOptions: exec.ExecOptions = {
    listeners: {
      stdout: (data: Buffer) => {
        const chunk = data.toString();
        stdout += chunk;
        if (verbose) {
          for (const line of chunk.split('\n')) {
            const trimmed = line.trim();
            if (trimmed) core.info(`  | ${trimmed.slice(0, 300)}`);
          }
        }
      },
      stderr: (data: Buffer) => {
        const chunk = data.toString();
        stderr += chunk;
        if (verbose) {
          for (const line of chunk.split('\n')) {
            const trimmed = line.trim();
            if (trimmed) core.info(`  |err| ${trimmed}`);
          }
        }
      },
    },
    ignoreReturnCode: true,
    silent: true,
    cwd: options?.cwd || undefined,
    env: {
      ...process.env,
      ...(process.env.ANTHROPIC_API_KEY && {
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY.replace(/\s/g, ''),
      }),
      ...(process.env.CLAUDE_CODE_OAUTH_TOKEN && {
        CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN.replace(/\s/g, ''),
      }),
    } as Record<string, string>,
  };

  let exitCode: number;
  try {
    exitCode = await execWithTimeout(cmd, args, execOptions, options?.timeout);
  } finally {
    if (heartbeat) clearInterval(heartbeat);
  }

  if (verbose) {
    const elapsed = Math.round((Date.now() - execStart) / 1000);
    core.info(`  [done] Agent finished in ${elapsed}s (stdout: ${stdout.length} bytes)`);
  }

  if (stderr && exitCode !== 0) {
    core.warning(`Agent stderr: ${stderr.slice(0, 500)}`);
  }

  return { output: stdout, exitCode };
}

async function execWithTimeout(
  cmd: string,
  args: string[],
  options: exec.ExecOptions,
  timeoutMs?: number,
): Promise<number> {
  if (!timeoutMs || timeoutMs <= 0) {
    return exec.exec(cmd, args, options);
  }

  let timer: ReturnType<typeof setTimeout>;
  let timedOut = false;

  const timeoutPromise = new Promise<number>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      core.warning(`Agent timed out after ${Math.round(timeoutMs / 1000)}s`);
      resolve(1);
    }, timeoutMs);
  });

  const execPromise = exec.exec(cmd, args, options);

  const exitCode = await Promise.race([execPromise, timeoutPromise]);
  clearTimeout(timer!);

  if (timedOut) {
    core.warning('Agent process may still be running in background after timeout');
  }

  return exitCode;
}
