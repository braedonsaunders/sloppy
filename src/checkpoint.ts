import * as core from '@actions/core';
import * as fs from 'fs';
import * as path from 'path';
import { LoopState } from './types';

const SLOPPY_DIR = '.sloppy';
const STATE_FILE = 'state.json';

function sloppyDir(): string {
  return path.join(process.env.GITHUB_WORKSPACE || process.cwd(), SLOPPY_DIR);
}

export function saveCheckpoint(state: LoopState): void {
  const dir = sloppyDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, STATE_FILE), JSON.stringify(state, null, 2));
  core.info(`Checkpoint saved: pass ${state.pass}, ${state.totalFixed} fixed`);
}

export function loadCheckpoint(): LoopState | null {
  const chainNumber = parseInt(core.getInput('chain_number') || '0');
  if (chainNumber === 0) return null;

  const filePath = path.join(sloppyDir(), STATE_FILE);
  if (!fs.existsSync(filePath)) {
    core.info('No checkpoint found');
    return null;
  }

  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as LoopState;
    data.chainNumber = chainNumber;
    core.info(`Resuming from checkpoint: pass ${data.pass}, chain ${chainNumber}`);
    return data;
  } catch (e) {
    core.warning(`Failed to load checkpoint: ${e}`);
    return null;
  }
}
