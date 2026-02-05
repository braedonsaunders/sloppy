#!/usr/bin/env node

import { spawn, execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";

// ─── Colors ──────────────────────────────────────────────────────────────────

const colors = {
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
};

// ─── Constants ───────────────────────────────────────────────────────────────

const PORT = 7749;
const HOST = "localhost";
const BASE_URL = `http://${HOST}:${PORT}`;
const HEALTH_URL = `${BASE_URL}/api/health`;
const PID_FILE_NAME = ".sloppy.pid";
const POLL_INTERVAL_MS = 500;
const MAX_POLL_ATTEMPTS = 60; // 30 seconds max wait

// ─── Banner ──────────────────────────────────────────────────────────────────

const BANNER = `
  ${colors.cyan("┌─────────────────────────────────────┐")}
  ${colors.cyan("│")}                                     ${colors.cyan("│")}
  ${colors.cyan("│")}   ${colors.bold("███████╗██╗      ██████╗ ██████╗ ")} ${colors.cyan("│")}
  ${colors.cyan("│")}   ${colors.bold("██╔════╝██║     ██╔═══██╗██╔══██╗")} ${colors.cyan("│")}
  ${colors.cyan("│")}   ${colors.bold("███████╗██║     ██║   ██║██████╔╝")} ${colors.cyan("│")}
  ${colors.cyan("│")}   ${colors.bold("╚════██║██║     ██║   ██║██╔═══╝ ")} ${colors.cyan("│")}
  ${colors.cyan("│")}   ${colors.bold("███████║███████╗╚██████╔╝██║     ")} ${colors.cyan("│")}
  ${colors.cyan("│")}   ${colors.bold("╚══════╝╚══════╝ ╚═════╝ ╚═╝     ")} ${colors.cyan("│")}
  ${colors.cyan("│")}                                     ${colors.cyan("│")}
  ${colors.cyan("│")}   Your AI writes code.              ${colors.cyan("│")}
  ${colors.cyan("│")}   Sloppy makes it production-ready. ${colors.cyan("│")}
  ${colors.cyan("│")}                                     ${colors.cyan("│")}
  ${colors.cyan("└─────────────────────────────────────┘")}
`;

// ─── Help ────────────────────────────────────────────────────────────────────

const HELP = `
${colors.bold("Sloppy")} - AI-powered code quality tool

${colors.bold("USAGE")}
  ${colors.cyan("sloppy")} [command]

${colors.bold("COMMANDS")}
  ${colors.cyan("start")}    Start the Sloppy server and open the browser ${colors.dim("(default)")}
  ${colors.cyan("stop")}     Stop the running Sloppy server
  ${colors.cyan("update")}   Pull latest changes and rebuild

${colors.bold("OPTIONS")}
  ${colors.cyan("--help")}      Show this help message
  ${colors.cyan("--version")}   Show version number
`;

// ─── Utilities ───────────────────────────────────────────────────────────────

function findProjectRoot(): string {
  // Start from the CLI package location and walk up
  let dir = dirname(fileURLToPath(import.meta.url));

  // Walk up from dist/ or src/ to packages/cli, then to project root
  for (let i = 0; i < 10; i++) {
    const pkgPath = join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        if (pkg.name === "sloppy") {
          return dir;
        }
      } catch {
        // ignore parse errors
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }

  // Fallback: try cwd
  const cwdPkg = join(process.cwd(), "package.json");
  if (existsSync(cwdPkg)) {
    try {
      const pkg = JSON.parse(readFileSync(cwdPkg, "utf-8"));
      if (pkg.name === "sloppy") {
        return process.cwd();
      }
    } catch {
      // ignore
    }
  }

  console.error(colors.red("Error: Could not find Sloppy project root."));
  console.error(
    colors.dim('Make sure you are inside the Sloppy project or it is installed correctly.')
  );
  process.exit(1);
}

function getPidFilePath(projectRoot: string): string {
  return join(projectRoot, PID_FILE_NAME);
}

function savePid(projectRoot: string, pid: number): void {
  writeFileSync(getPidFilePath(projectRoot), String(pid), "utf-8");
}

function readPid(projectRoot: string): number | null {
  const pidFile = getPidFilePath(projectRoot);
  if (!existsSync(pidFile)) return null;
  try {
    const pid = parseInt(readFileSync(pidFile, "utf-8").trim(), 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

function removePidFile(projectRoot: string): void {
  const pidFile = getPidFilePath(projectRoot);
  try {
    if (existsSync(pidFile)) unlinkSync(pidFile);
  } catch {
    // ignore
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function checkPort(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(BASE_URL, () => {
      resolve(true);
    });
    req.on("error", () => {
      resolve(false);
    });
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function waitForHealth(): Promise<boolean> {
  return new Promise((resolve) => {
    let attempts = 0;

    const poll = () => {
      attempts++;
      if (attempts > MAX_POLL_ATTEMPTS) {
        resolve(false);
        return;
      }

      const req = http.get(HEALTH_URL, (res) => {
        if (res.statusCode === 200) {
          resolve(true);
        } else {
          setTimeout(poll, POLL_INTERVAL_MS);
        }
      });

      req.on("error", () => {
        setTimeout(poll, POLL_INTERVAL_MS);
      });

      req.setTimeout(2000, () => {
        req.destroy();
        setTimeout(poll, POLL_INTERVAL_MS);
      });
    };

    poll();
  });
}

function getVersion(projectRoot: string): string {
  try {
    const pkgPath = join(projectRoot, "packages", "cli", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    return pkg.version || "unknown";
  } catch {
    return "unknown";
  }
}

// ─── Commands ────────────────────────────────────────────────────────────────

async function start(projectRoot: string): Promise<void> {
  console.log(BANNER);

  // Check if server is already running
  const portInUse = await checkPort();
  if (portInUse) {
    console.log(colors.green("  Server is already running!"));
    console.log(`  ${colors.cyan(BASE_URL)}\n`);
    const open = (await import("open")).default;
    await open(BASE_URL);
    return;
  }

  // Check if the server dist exists
  const serverEntry = join(projectRoot, "packages", "server", "dist", "index.js");
  if (!existsSync(serverEntry)) {
    console.error(colors.red("  Error: Server has not been built yet."));
    console.error(colors.dim("  Run `pnpm build` first, or use `sloppy update`."));
    process.exit(1);
  }

  // Start server as a background process
  console.log(colors.dim("  Starting server..."));

  const child = spawn("node", [serverEntry], {
    cwd: projectRoot,
    stdio: "ignore",
    detached: true,
    env: { ...process.env, NODE_ENV: "production" },
  });

  child.unref();

  if (child.pid) {
    savePid(projectRoot, child.pid);
  }

  // Wait for the server to be healthy
  process.stdout.write(colors.dim("  Waiting for server to be ready"));
  const dotInterval = setInterval(() => {
    process.stdout.write(colors.dim("."));
  }, POLL_INTERVAL_MS);

  const healthy = await waitForHealth();
  clearInterval(dotInterval);
  console.log();

  if (!healthy) {
    console.error(colors.red("\n  Error: Server failed to start within 30 seconds."));
    console.error(colors.dim("  Check the server logs for more details."));

    // Clean up
    if (child.pid) {
      try {
        process.kill(child.pid, "SIGTERM");
      } catch {
        // ignore
      }
    }
    removePidFile(projectRoot);
    process.exit(1);
  }

  console.log(colors.green("  Server is ready!"));
  console.log();
  console.log(`  ${colors.bold("Local:")}   ${colors.cyan(BASE_URL)}`);
  console.log();

  // Open browser
  const open = (await import("open")).default;
  await open(BASE_URL);

  console.log(colors.dim("  Browser opened. You can close this terminal."));
  console.log(colors.dim(`  To stop the server, run: ${colors.cyan("sloppy stop")}`));
  console.log();
}

async function stop(projectRoot: string): Promise<void> {
  // First, try the PID file
  const pid = readPid(projectRoot);

  if (pid && isProcessRunning(pid)) {
    console.log(colors.dim(`  Stopping server (PID: ${pid})...`));
    try {
      process.kill(pid, "SIGTERM");
      removePidFile(projectRoot);
      console.log(colors.green("  Server stopped."));
      return;
    } catch (err) {
      console.error(colors.red(`  Failed to stop process ${pid}: ${err}`));
    }
  }

  // Fallback: check if anything is listening on the port
  const portInUse = await checkPort();
  if (portInUse) {
    // Try to find the process using the port
    try {
      const result = execSync(`lsof -ti :${PORT} 2>/dev/null || true`, {
        encoding: "utf-8",
      }).trim();

      if (result) {
        const pids = result.split("\n").map((p) => parseInt(p.trim(), 10)).filter((p) => !isNaN(p));
        for (const p of pids) {
          try {
            process.kill(p, "SIGTERM");
            console.log(colors.dim(`  Stopped process ${p}`));
          } catch {
            // ignore
          }
        }
        removePidFile(projectRoot);
        console.log(colors.green("  Server stopped."));
        return;
      }
    } catch {
      // lsof not available
    }

    console.error(
      colors.yellow("  A process is running on port " + PORT + " but could not be identified.")
    );
    console.error(colors.dim(`  Try manually: kill $(lsof -ti :${PORT})`));
    process.exit(1);
  }

  // Nothing running
  removePidFile(projectRoot);
  console.log(colors.yellow("  Server is not running."));
}

async function update(projectRoot: string): Promise<void> {
  console.log(colors.bold("  Updating Sloppy...\n"));

  // Step 1: git pull
  console.log(colors.dim("  Pulling latest changes..."));
  try {
    execSync("git pull", { cwd: projectRoot, stdio: "inherit" });
  } catch {
    console.error(colors.red("\n  Error: git pull failed."));
    process.exit(1);
  }

  console.log();

  // Step 2: pnpm install && pnpm build
  console.log(colors.dim("  Installing dependencies..."));
  try {
    execSync("pnpm install", { cwd: projectRoot, stdio: "inherit" });
  } catch {
    console.error(colors.red("\n  Error: pnpm install failed."));
    process.exit(1);
  }

  console.log();
  console.log(colors.dim("  Building..."));
  try {
    execSync("pnpm build", { cwd: projectRoot, stdio: "inherit" });
  } catch {
    console.error(colors.red("\n  Error: pnpm build failed."));
    process.exit(1);
  }

  console.log();
  console.log(colors.green("  Update complete!"));
  console.log(colors.dim(`  Run ${colors.cyan("sloppy start")} to launch.\n`));
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] || "start";

  // Handle flags
  if (command === "--help" || command === "-h") {
    console.log(HELP);
    return;
  }

  if (command === "--version" || command === "-v") {
    const projectRoot = findProjectRoot();
    console.log(`sloppy v${getVersion(projectRoot)}`);
    return;
  }

  const projectRoot = findProjectRoot();

  switch (command) {
    case "start":
      await start(projectRoot);
      break;
    case "stop":
      await stop(projectRoot);
      break;
    case "update":
      await update(projectRoot);
      break;
    default:
      console.error(colors.red(`  Unknown command: ${command}`));
      console.log(HELP);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(colors.red(`\n  Fatal error: ${err.message}`));
  process.exit(1);
});
