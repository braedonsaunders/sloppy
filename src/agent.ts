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
  const verbose = options?.verbose ?? false;

  const execOptions: exec.ExecOptions = {
    listeners: {
      stdout: (data: Buffer) => {
        const chunk = data.toString();
        stdout += chunk;
        if (verbose) {
          // Stream each line to the Actions log in real-time
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
    silent: true, // suppress @actions/exec default output; we handle it ourselves
    env: { ...process.env } as Record<string, string>,
  };

  let exitCode: number;

  if (agent === 'claude') {
    const args = ['-p', prompt, '--output-format', 'json', '--dangerously-skip-permissions'];
    if (options?.maxTurns) args.push('--max-turns', String(options.maxTurns));
    if (options?.model) args.push('--model', options.model);
    if (verbose) args.push('--verbose');
    exitCode = await exec.exec('claude', args, execOptions);
  } else {
    const args = ['exec', '--full-auto', '--quiet', prompt];
    if (options?.model) args.push('--model', options.model);
    exitCode = await exec.exec('codex', args, execOptions);
  }

  if (stderr && exitCode !== 0) {
    core.warning(`Agent stderr: ${stderr.slice(0, 500)}`);
  }

  return { output: stdout, exitCode };
}
