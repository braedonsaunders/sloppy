import * as core from '@actions/core';
import * as exec from '@actions/exec';
import { AgentType } from './types';

export async function installAgent(agent: AgentType): Promise<void> {
  if (agent === 'claude') {
    await exec.exec('npm', ['install', '-g', '@anthropic-ai/claude-code']);
  } else {
    await exec.exec('npm', ['install', '-g', '@openai/codex']);
  }
}

export async function runAgent(
  agent: AgentType,
  prompt: string,
  options?: {
    maxTurns?: number;
    model?: string;
    timeout?: number;
    verbose?: boolean;
  },
): Promise<{ output: string; exitCode: number }> {
  let stdout = '';
  let stderr = '';
  let agentResult = '';
  let lineBuffer = '';
  const verbose = options?.verbose ?? false;
  const execStart = Date.now();
  let firstStdoutChunk = true;
  let eventCount = 0;

  const processStreamLine = (line: string): void => {
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
        } else if (event.type === 'tool_use') {
          const name = event.tool?.name || event.name || 'unknown';
          core.info(`  | [tool: ${name}]`);
        } else if (event.type === 'tool_result') {
          // tool completed, no extra logging needed
        } else if (event.type === 'system') {
          core.info(`  | [system: ${event.subtype || 'init'}]`);
        }
      }
    } catch {
      // Not valid JSON — log raw line in verbose mode
      if (verbose) core.info(`  | ${trimmed.slice(0, 300)}`);
    }
  };

  // Heartbeat: log every 30s while agent is running so the user knows it's alive
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  if (verbose) {
    heartbeat = setInterval(() => {
      const elapsed = Math.round((Date.now() - execStart) / 1000);
      core.info(`  ... agent running (${elapsed}s, ${eventCount} events, stdout: ${stdout.length} bytes)`);
    }, 30_000);
  }

  const execOptions: exec.ExecOptions = {
    listeners: {
      stdout: (data: Buffer) => {
        const chunk = data.toString();
        stdout += chunk;

        if (firstStdoutChunk && verbose) {
          firstStdoutChunk = false;
          const elapsed = Math.round((Date.now() - execStart) / 1000);
          core.info(`  [stream] First output received after ${elapsed}s (${chunk.length} bytes)`);
        }

        if (agent === 'claude') {
          lineBuffer += chunk;
          const lines = lineBuffer.split('\n');
          lineBuffer = lines.pop() || '';
          for (const line of lines) {
            processStreamLine(line);
          }
        } else if (verbose) {
          for (const line of chunk.split('\n')) {
            const trimmed = line.trim();
            if (trimmed) core.info(`  | ${trimmed}`);
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
    env: { ...process.env } as Record<string, string>,
  };

  let exitCode: number;

  try {
    if (agent === 'claude') {
      const args = ['-p', prompt, '--output-format', 'stream-json', '--dangerously-skip-permissions'];
      if (options?.maxTurns) args.push('--max-turns', String(options.maxTurns));
      if (options?.model) args.push('--model', options.model);
      if (verbose) args.push('--verbose');
      exitCode = await execWithTimeout(
        'claude', args, execOptions, options?.timeout,
      );

      // Process any remaining buffered data
      if (lineBuffer.trim()) processStreamLine(lineBuffer);
    } else {
      const args = ['exec', '--full-auto', '--quiet', prompt];
      if (options?.model) args.push('--model', options.model);
      exitCode = await execWithTimeout(
        'codex', args, execOptions, options?.timeout,
      );
    }
  } finally {
    if (heartbeat) clearInterval(heartbeat);
  }

  if (verbose) {
    const elapsed = Math.round((Date.now() - execStart) / 1000);
    core.info(`  [stream] Agent finished in ${elapsed}s (${eventCount} events, stdout: ${stdout.length} bytes, stderr: ${stderr.length} bytes)`);
  }

  if (stderr && exitCode !== 0) {
    core.warning(`Agent stderr: ${stderr.slice(0, 500)}`);
  }

  const output = agent === 'claude' ? agentResult : stdout;
  return { output, exitCode };
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
    // The process may still be running, but the caller will treat this as a failure
    core.warning('Agent process may still be running in background after timeout');
  }

  return exitCode;
}
