#!/usr/bin/env node
/**
 * Clean all dist folders in the monorepo
 * Cross-platform script for use with pnpm update:clean
 */

import { rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const packages = ['server', 'ui', 'analyzers', 'core', 'providers', 'git'];

console.log('Cleaning dist folders...');

for (const pkg of packages) {
  const distPath = join(process.cwd(), 'packages', pkg, 'dist');
  if (existsSync(distPath)) {
    rmSync(distPath, { recursive: true, force: true });
    console.log(`  Removed: packages/${pkg}/dist`);
  }
}

console.log('Done.');
