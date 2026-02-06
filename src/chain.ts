import * as core from '@actions/core';
import * as github from '@actions/github';
import { LoopState } from './types';

export async function triggerChain(state: LoopState): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    core.warning('Cannot chain: no GITHUB_TOKEN');
    return;
  }

  const octokit = github.getOctokit(token);
  const [owner, repo] = (process.env.GITHUB_REPOSITORY || '').split('/');
  const ref = (process.env.GITHUB_REF || 'main').replace('refs/heads/', '');

  // Determine workflow filename from GITHUB_WORKFLOW_REF
  const workflowRef = process.env.GITHUB_WORKFLOW_REF || '';
  let workflowFile = workflowRef.split('@')[0]?.split('/').pop() || 'sloppy.yml';

  const nextChain = state.chainNumber + 1;
  core.info(`Triggering chain ${nextChain} via ${workflowFile}...`);

  try {
    await octokit.rest.actions.createWorkflowDispatch({
      owner,
      repo,
      workflow_id: workflowFile,
      ref,
      inputs: { chain_number: String(nextChain) },
    });
    core.info(`Chain ${nextChain} triggered`);
  } catch (e) {
    core.warning(`Failed to trigger chain: ${e}`);
  }
}
