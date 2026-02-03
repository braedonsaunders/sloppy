import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/core',
  'packages/server',
  'packages/providers',
  'packages/analyzers',
  'packages/git',
]);
