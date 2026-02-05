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
  ${colors.cyan("sloppy")} [command] [options]

${colors.bold("COMMANDS")}
  ${colors.cyan("start")}    Start the Sloppy server and open the browser ${colors.dim("(default)")}
  ${colors.cyan("scan")}     Scan current directory and show results
  ${colors.cyan("stop")}     Stop the running Sloppy server
  ${colors.cyan("update")}   Pull latest changes and rebuild

${colors.bold("OPTIONS")}
  ${colors.cyan("--fix")}       Auto-fix detected issues (with scan)
  ${colors.cyan("--json")}      Output results as JSON (with scan)
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

  // Auto-create session for cwd
  const cwd = process.cwd();
  try {
    // Detect project
    const detectRes = await fetch(`${BASE_URL}/api/detect?path=${encodeURIComponent(cwd)}`);
    const detectData = await detectRes.json();

    // Find a configured provider
    const providersRes = await fetch(`${BASE_URL}/api/providers`);
    const providersData = await providersRes.json();
    const configuredProvider = (providersData as any)?.data?.find((p: any) => p.configured);

    if (configuredProvider && (detectData as any)?.success) {
      const d = (detectData as any).data;
      // Create a session
      const sessionRes = await fetch(`${BASE_URL}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repoPath: cwd,
          provider: configuredProvider.id,
          config: {
            testCommand: d?.commands?.test,
            lintCommand: d?.commands?.lint,
            buildCommand: d?.commands?.build,
          }
        })
      });
      const sessionData = await sessionRes.json();
      if ((sessionData as any)?.success) {
        // Open browser directly to the session
        const open = (await import("open")).default;
        await open(`${BASE_URL}/session/${(sessionData as any).data.id}`);
        console.log(colors.dim("  Browser opened to session. You can close this terminal."));
        console.log(colors.dim(`  To stop the server, run: ${colors.cyan("sloppy stop")}`));
        console.log();
        return;
      }
    }
  } catch {
    // Fall through to just opening the dashboard
  }

  // Fallback: open dashboard
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

async function scan(projectRoot: string, targetDir: string, fix: boolean, json: boolean): Promise<void> {
  if (!json) {
    console.log(BANNER);
    console.log(colors.dim("  Scanning ") + colors.cyan(targetDir) + colors.dim("..."));
    console.log();
  }

  // Ensure server is running
  let serverStarted = false;
  const portInUse = await checkPort();
  if (!portInUse) {
    if (!json) console.log(colors.dim("  Starting server..."));
    // Start server (reuse existing start logic but don't open browser)
    const serverEntry = join(projectRoot, "packages", "server", "dist", "index.js");
    if (!existsSync(serverEntry)) {
      console.error(json ? JSON.stringify({ error: "Server not built" }) : colors.red("  Server not built. Run pnpm build first."));
      process.exit(1);
    }
    const child = spawn("node", [serverEntry], {
      cwd: projectRoot,
      stdio: "ignore",
      detached: true,
      env: { ...process.env, NODE_ENV: "production" },
    });
    child.unref();
    if (child.pid) savePid(projectRoot, child.pid);
    const healthy = await waitForHealth();
    if (!healthy) {
      console.error(json ? JSON.stringify({ error: "Server failed to start" }) : colors.red("  Server failed to start."));
      process.exit(1);
    }
    serverStarted = true;
    if (!json) console.log(colors.green("  Server started."));
    if (!json) console.log();
  }

  try {
    // Detect project
    const detectRes = await fetch(`${BASE_URL}/api/detect?path=${encodeURIComponent(targetDir)}`);
    const detectData = (await detectRes.json()) as any;

    if (!json && detectData?.success) {
      const d = detectData.data;
      console.log(`  ${colors.bold("Project:")} ${d.language}${d.framework ? ` (${d.framework})` : ""}`);
      if (d.packageManager) console.log(`  ${colors.bold("Package Manager:")} ${d.packageManager}`);
      console.log();
    }

    // Find provider
    const providersRes = await fetch(`${BASE_URL}/api/providers`);
    const providersData = (await providersRes.json()) as any;
    const provider = providersData?.data?.find((p: any) => p.configured);

    if (!provider) {
      const msg = "No AI provider configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY env var, or configure via web UI.";
      console.error(json ? JSON.stringify({ error: msg }) : colors.red(`  ${msg}`));
      process.exit(1);
    }

    if (!json) {
      console.log(`  ${colors.bold("Provider:")} ${provider.name}`);
      console.log();
    }

    // The scan output message
    if (!json) {
      console.log(colors.dim("  Analysis will begin in the dashboard."));
      console.log(`  ${colors.cyan(`${BASE_URL}`)}`);
    }

    if (json) {
      console.log(JSON.stringify({
        project: detectData?.data,
        provider: provider.id,
        status: "ready",
        dashboardUrl: BASE_URL,
      }));
    }
  } catch (err) {
    console.error(json ? JSON.stringify({ error: String(err) }) : colors.red(`  Error: ${err}`));
    process.exit(1);
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Handle flags first
  if (args.includes("--help") || args.includes("-h")) {
    console.log(HELP);
    return;
  }

  if (args.includes("--version") || args.includes("-v")) {
    const projectRoot = findProjectRoot();
    console.log(`sloppy v${getVersion(projectRoot)}`);
    return;
  }

  // If --fix or --json is passed without an explicit command, route to scan
  const hasFixFlag = args.includes("--fix");
  const hasJsonFlag = args.includes("--json");
  const positionalArgs = args.filter((a) => !a.startsWith("--"));
  const command = positionalArgs[0] || (hasFixFlag || hasJsonFlag ? "scan" : "start");

  const projectRoot = findProjectRoot();

  switch (command) {
    case "start":
      await start(projectRoot);
      break;
    case "scan":
      await scan(projectRoot, process.cwd(), hasFixFlag, hasJsonFlag);
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
