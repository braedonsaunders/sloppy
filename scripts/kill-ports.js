#!/usr/bin/env node
/**
 * Kill processes using the dev server ports
 * This ensures clean startup when running `pnpm dev`
 */

const { execSync } = require('child_process');
const os = require('os');

const PORTS = [5173, 7749]; // Vite UI port, Server port

function killPort(port) {
  const platform = os.platform();

  try {
    if (platform === 'win32') {
      // Windows: find PID and kill it
      const result = execSync(`netstat -ano | findstr :${port} | findstr LISTENING`, { encoding: 'utf8' });
      const lines = result.trim().split('\n');
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && pid !== '0') {
          try {
            execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
            console.log(`  Killed process ${pid} on port ${port}`);
          } catch {
            // Process might have already exited
          }
        }
      }
    } else {
      // macOS/Linux: use lsof and kill
      const result = execSync(`lsof -ti:${port}`, { encoding: 'utf8' });
      const pids = result.trim().split('\n').filter(Boolean);
      for (const pid of pids) {
        try {
          execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
          console.log(`  Killed process ${pid} on port ${port}`);
        } catch {
          // Process might have already exited
        }
      }
    }
    return true;
  } catch {
    // No process found on this port (this is fine)
    return false;
  }
}

console.log('Cleaning up dev server ports...');

let killedAny = false;
for (const port of PORTS) {
  if (killPort(port)) {
    killedAny = true;
  }
}

if (killedAny) {
  console.log('Port cleanup complete.\n');
} else {
  console.log('All ports are available.\n');
}
