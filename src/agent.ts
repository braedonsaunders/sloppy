import * as core from '@actions/core';
import * as exec from '@actions/exec';
import { AgentType } from './types';

export async function installAgent(agent: AgentType): Promise<void> {
  core.info(`Installing ${agent} CLI...`);
  if (agent === 'claude') {
    await exec.exec('npm', ['install', '-g', '@anthropic-ai/claude-code']);
  } else {
    await exec.exec('npm', ['install', '-g', '@openai/codex']);
  }
}

export async function runAgent(
  agent: AgentType,
  prompt: string,
  options?: { maxTurns?: number; model?: string; timeout?: number },
): Promise<{ output: string; exitCode: number }> {
  let stdout = '';
  let stderr = '';

  const execOptions: exec.ExecOptions = {
    listeners: {
      stdout: (data: Buffer) => { stdout += data.toString(); },
      stderr: (data: Buffer) => { stderr += data.toString(); },
    },
    ignoreReturnCode: true,
    env: { ...process.env } as Record<string, string>,
  };

  let exitCode: number;

  if (agent === 'claude') {
    const args = ['-p', prompt, '--output-format', 'json', '--dangerously-skip-permissions'];
    if (options?.maxTurns) args.push('--max-turns', String(options.maxTurns));
    if (options?.model) args.push('--model', options.model);
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
