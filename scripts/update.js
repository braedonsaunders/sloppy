#!/usr/bin/env node
/**
 * Update script that handles local changes gracefully
 * Stashes changes, pulls, restores stash, then installs, builds, and starts
 *
 * Usage:
 *   pnpm update         - Normal update (stash, pull, install, build, start)
 *   pnpm update:clean   - Clean update (also removes dist folders)
 */

import { execSync } from 'node:child_process';
import { rmSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const isClean = process.argv.includes('--clean');

function run(cmd, options = {}) {
  console.log(`> ${cmd}`);
  try {
    execSync(cmd, { stdio: 'inherit', ...options });
    return true;
  } catch (error) {
    if (!options.ignoreError) {
      throw error;
    }
    return false;
  }
}

function cleanDist() {
  console.log('Cleaning dist folders...');
  const packagesDir = join(process.cwd(), 'packages');

  if (existsSync(packagesDir)) {
    for (const pkg of readdirSync(packagesDir)) {
      const distPath = join(packagesDir, pkg, 'dist');
      if (existsSync(distPath)) {
        console.log(`  Removing ${pkg}/dist`);
        rmSync(distPath, { recursive: true, force: true });
      }
    }
  }
}

async function main() {
  console.log(`Updating sloppy${isClean ? ' (clean)' : ''}...\n`);

  // Check if there are any local changes
  let hasStash = false;
  try {
    const status = execSync('git status --porcelain', { encoding: 'utf-8' });
    if (status.trim()) {
      console.log('Stashing local changes...');
      run('git stash --include-untracked');
      hasStash = true;
    }
  } catch {
    // Ignore git status errors
  }

  try {
    // Pull latest changes
    run('git pull');

    // Clean dist folders if requested
    if (isClean) {
      cleanDist();
    }

    // Install dependencies (regenerates lock file if needed)
    run('pnpm install');

    // Build all packages
    run('pnpm build');

    console.log('\n✓ Update complete!');
  } finally {
    // Restore stashed changes if we stashed anything
    if (hasStash) {
      console.log('\nRestoring stashed changes...');
      run('git stash pop', { ignoreError: true });
    }
  }

  // Kill existing processes on dev ports and start the server
  console.log('\nStarting server...');
  run('pnpm run kill-ports');
  run('pnpm start');
}

main().catch((error) => {
  console.error('\n✗ Update failed:', error.message);
  process.exit(1);
});
