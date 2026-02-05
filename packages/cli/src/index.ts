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
  ${colors.cyan("watch")}    Watch for file changes and re-analyze
  ${colors.cyan("report")}   Generate a report for the latest session
  ${colors.cyan("stop")}     Stop the running Sloppy server
  ${colors.cyan("update")}   Pull latest changes and rebuild

${colors.bold("OPTIONS")}
  ${colors.cyan("--fix")}       Auto-fix detected issues (with scan)
  ${colors.cyan("--json")}      Output results as JSON (with scan/report)
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

    if (!configuredProvider) {
      // No provider configured - open onboarding
      const open = (await import("open")).default;
      await open(`${BASE_URL}/setup`);
      console.log(colors.dim("  Opening setup wizard in browser."));
      console.log(colors.dim(`  To stop the server, run: ${colors.cyan("sloppy stop")}`));
      console.log();
      return;
    }

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

async function ensureServer(projectRoot: string, json: boolean): Promise<boolean> {
  const portInUse = await checkPort();
  if (portInUse) return false;

  if (!json) console.log(colors.dim("  Starting server..."));
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
  if (!json) console.log(colors.green("  Server started."));
  if (!json) console.log();
  return true;
}

function severityIcon(severity: string): string {
  switch (severity) {
    case "error": return colors.red("●");
    case "warning": return colors.yellow("●");
    case "info": return colors.cyan("●");
    default: return colors.dim("●");
  }
}

function scoreBar(score: number): string {
  const width = 30;
  const filled = Math.round((score / 100) * width);
  const empty = width - filled;
  const color = score >= 80 ? colors.green : score >= 60 ? colors.yellow : colors.red;
  return color("█".repeat(filled)) + colors.dim("░".repeat(empty)) + ` ${score}/100`;
}

async function scan(projectRoot: string, targetDir: string, fix: boolean, json: boolean): Promise<void> {
  if (!json) {
    console.log(BANNER);
    console.log(colors.dim("  Scanning ") + colors.cyan(targetDir) + colors.dim("..."));
    console.log();
  }

  await ensureServer(projectRoot, json);

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
      if (!json) {
        console.log(colors.yellow("  No AI provider configured."));
        console.log(colors.dim("  Set ANTHROPIC_API_KEY or OPENAI_API_KEY env var,"));
        console.log(colors.dim("  or configure via the web UI:"));
        console.log();
        console.log(`  ${colors.cyan(`${BASE_URL}/setup`)}`);
        console.log();
      } else {
        console.log(JSON.stringify({ error: "No AI provider configured", setupUrl: `${BASE_URL}/setup` }));
      }
      process.exit(1);
    }

    if (!json) {
      console.log(`  ${colors.bold("Provider:")} ${provider.name}`);
      console.log();
    }

    // Create a session and wait for analysis
    const sessionRes = await fetch(`${BASE_URL}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repoPath: targetDir,
        provider: provider.id,
        config: {
          strictness: 'medium',
          issueTypes: ['lint', 'type', 'security', 'bugs'],
          testCommand: detectData?.data?.commands?.test,
          lintCommand: detectData?.data?.commands?.lint,
          buildCommand: detectData?.data?.commands?.build,
        }
      })
    });
    const sessionData = (await sessionRes.json()) as any;

    if (!sessionData?.success) {
      console.error(json ? JSON.stringify({ error: "Failed to create session" }) : colors.red("  Failed to create session."));
      process.exit(1);
    }

    const sessionId = sessionData.data.id;

    // Start the session
    await fetch(`${BASE_URL}/api/sessions/${sessionId}/start`, { method: 'POST' });

    if (!json) {
      process.stdout.write(colors.dim("  Analyzing"));
    }

    // Poll for completion
    let status = "running";
    const dotInterval = !json ? setInterval(() => {
      process.stdout.write(colors.dim("."));
    }, 1000) : null;

    for (let i = 0; i < 360; i++) { // Max 30 min
      await new Promise((r) => setTimeout(r, 5000));
      const statusRes = await fetch(`${BASE_URL}/api/sessions/${sessionId}`);
      const statusData = (await statusRes.json()) as any;
      status = statusData?.data?.session?.status ?? statusData?.data?.status ?? "unknown";
      if (status === "completed" || status === "failed" || status === "stopped") break;
    }

    if (dotInterval) clearInterval(dotInterval);
    if (!json) console.log();
    if (!json) console.log();

    // Compute score
    await fetch(`${BASE_URL}/api/sessions/${sessionId}/score`, { method: 'POST' });

    // Get results
    const issuesRes = await fetch(`${BASE_URL}/api/sessions/${sessionId}/issues`);
    const issuesData = (await issuesRes.json()) as any;
    const issues = issuesData?.data?.issues ?? [];
    const summary = issuesData?.data?.summary ?? {};

    const scoreRes = await fetch(`${BASE_URL}/api/sessions/${sessionId}/score`);
    const scoreData = (await scoreRes.json()) as any;
    const score = scoreData?.data?.score?.score ?? 0;

    if (json) {
      console.log(JSON.stringify({
        sessionId,
        score,
        status,
        summary,
        issues: issues.slice(0, 100).map((i: any) => ({
          type: i.type,
          severity: i.severity,
          file: i.file_path,
          line: i.line_start,
          description: i.description,
          status: i.status,
        })),
        reportUrl: `${BASE_URL}/api/sessions/${sessionId}/report`,
        badgeUrl: `${BASE_URL}/api/sessions/${sessionId}/badge`,
      }));
      return;
    }

    // Beautiful CLI output
    console.log(`  ${colors.bold("Sloppy Score")}`);
    console.log(`  ${scoreBar(score)}`);
    console.log();

    console.log(`  ${colors.bold("Summary")}`);
    console.log(`  Issues found:    ${summary.total ?? issues.length}`);
    console.log(`  ${colors.red("Errors:")}         ${summary.bySeverity?.error ?? 0}`);
    console.log(`  ${colors.yellow("Warnings:")}       ${summary.bySeverity?.warning ?? 0}`);
    console.log(`  ${colors.cyan("Info:")}            ${summary.bySeverity?.info ?? 0}`);
    console.log();

    // Show top issues (max 15)
    const topIssues = issues
      .sort((a: any, b: any) => {
        const sev = { error: 0, warning: 1, info: 2, hint: 3 };
        return (sev[a.severity as keyof typeof sev] ?? 3) - (sev[b.severity as keyof typeof sev] ?? 3);
      })
      .slice(0, 15);

    if (topIssues.length > 0) {
      console.log(`  ${colors.bold("Top Issues")}`);
      for (const issue of topIssues) {
        const file = (issue.file_path as string).split("/").slice(-2).join("/");
        const line = issue.line_start ? `:${issue.line_start}` : "";
        console.log(`  ${severityIcon(issue.severity)} ${colors.dim(`${file}${line}`)} ${issue.description}`);
      }
      if (issues.length > 15) {
        console.log(colors.dim(`  ...and ${issues.length - 15} more`));
      }
      console.log();
    }

    // Report and badge links
    console.log(`  ${colors.bold("Links")}`);
    console.log(`  Report:    ${colors.cyan(`${BASE_URL}/api/sessions/${sessionId}/report`)}`);
    console.log(`  Badge:     ${colors.cyan(`${BASE_URL}/api/sessions/${sessionId}/badge`)}`);
    console.log(`  Dashboard: ${colors.cyan(`${BASE_URL}/session/${sessionId}`)}`);
    console.log();

  } catch (err) {
    console.error(json ? JSON.stringify({ error: String(err) }) : colors.red(`  Error: ${err}`));
    process.exit(1);
  }
}

async function watch(projectRoot: string, targetDir: string): Promise<void> {
  console.log(BANNER);
  console.log(colors.dim("  Watching ") + colors.cyan(targetDir) + colors.dim(" for changes..."));
  console.log(colors.dim("  Press Ctrl+C to stop."));
  console.log();

  await ensureServer(projectRoot, false);

  // Dynamically import chokidar or fall back to fs.watch
  let watcher: { close: () => void } | null = null;
  let debounceTimer: NodeJS.Timeout | null = null;
  let isAnalyzing = false;

  const runAnalysis = async (): Promise<void> => {
    if (isAnalyzing) return;
    isAnalyzing = true;

    console.log(colors.dim(`  [${new Date().toLocaleTimeString()}] Changes detected, re-analyzing...`));

    try {
      // Find provider
      const providersRes = await fetch(`${BASE_URL}/api/providers`);
      const providersData = (await providersRes.json()) as any;
      const provider = providersData?.data?.find((p: any) => p.configured);

      if (!provider) {
        console.log(colors.yellow("  No AI provider configured. Skipping analysis."));
        isAnalyzing = false;
        return;
      }

      // Create session
      const sessionRes = await fetch(`${BASE_URL}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repoPath: targetDir,
          provider: provider.id,
          config: {
            strictness: 'medium',
            issueTypes: ['lint', 'type', 'security', 'bugs'],
          }
        })
      });
      const sessionData = (await sessionRes.json()) as any;
      if (sessionData?.success) {
        await fetch(`${BASE_URL}/api/sessions/${sessionData.data.id}/start`, { method: 'POST' });
        console.log(`  ${colors.green("●")} Session started: ${colors.cyan(`${BASE_URL}/session/${sessionData.data.id}`)}`);
      }
    } catch (err) {
      console.log(colors.red(`  Error: ${err}`));
    } finally {
      isAnalyzing = false;
    }
  };

  const onChange = (): void => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      void runAnalysis();
    }, 2000); // 2 second debounce
  };

  // Use Node.js fs.watch recursively
  const { watch: fsWatch } = await import("node:fs");
  try {
    watcher = fsWatch(targetDir, { recursive: true }, (eventType, filename) => {
      if (!filename) return;
      // Skip common noise
      if (filename.includes("node_modules") || filename.includes(".git") || filename.includes("dist/") || filename.includes(".sloppy")) return;
      onChange();
    });
    console.log(colors.green("  Watcher started."));
    console.log();
  } catch {
    console.error(colors.red("  Failed to start file watcher."));
    process.exit(1);
  }

  // Run initial analysis
  await runAnalysis();

  // Keep process alive
  await new Promise<void>((resolve) => {
    process.on("SIGINT", () => {
      console.log();
      console.log(colors.dim("  Stopping watcher..."));
      if (watcher) watcher.close();
      resolve();
    });
  });
}

async function report(projectRoot: string, json: boolean): Promise<void> {
  await ensureServer(projectRoot, json);

  try {
    // Get the latest session
    const sessionsRes = await fetch(`${BASE_URL}/api/sessions`);
    const sessionsData = (await sessionsRes.json()) as any;
    const sessions = sessionsData?.data ?? [];

    if (sessions.length === 0) {
      console.error(json ? JSON.stringify({ error: "No sessions found" }) : colors.red("  No sessions found. Run 'sloppy scan' first."));
      process.exit(1);
    }

    // Find the most recent completed session
    const latest = sessions
      .filter((s: any) => s.status === "completed" || s.status === "stopped")
      .sort((a: any, b: any) => new Date(b.created_at ?? b.createdAt ?? 0).getTime() - new Date(a.created_at ?? a.createdAt ?? 0).getTime())[0]
      ?? sessions[0];

    const sessionId = latest.id;
    const format = json ? "json" : "html";
    const reportRes = await fetch(`${BASE_URL}/api/sessions/${sessionId}/report?format=${format}`);

    if (json) {
      const data = await reportRes.json();
      console.log(JSON.stringify(data, null, 2));
    } else {
      const html = await reportRes.text();
      // Write to file
      const reportPath = join(process.cwd(), "sloppy-report.html");
      writeFileSync(reportPath, html, "utf-8");
      console.log(colors.green(`  Report saved to ${reportPath}`));
      console.log(colors.dim(`  Open in browser to view.`));
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
    case "watch":
      await watch(projectRoot, process.cwd());
      break;
    case "report":
      await report(projectRoot, hasJsonFlag);
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
