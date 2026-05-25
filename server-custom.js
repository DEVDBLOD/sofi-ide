// Custom Next.js server with WebSocket PTY terminal support
// Dev: uses next() API directly
// Production: hooks into Next.js standalone startServer() via http.createServer intercept
const http = require("http");
const { parse } = require("url");
const { WebSocketServer } = require("ws");
const { spawn, execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const dev = process.env.NODE_ENV !== "production";
const port = parseInt(process.env.PORT || "3000", 10);
const PROJECTS_ROOT = path.join(__dirname, "projects");

// ── Session limits ─────────────────────────────────────────────────────
const MAX_CONCURRENT_SESSIONS = 30;
const activePtyProcesses = new Map(); // ws → { ptyProc, sessionName }

// Expose active sessions for the sessions API (read by src/app/api/terminal/sessions/route.ts)
(globalThis).__activeTerminals = activePtyProcesses;

// ── Cross-platform shell resolution ─────────────────────────────────────
function getDefaultShell() {
  if (process.platform === "win32") {
    return "powershell.exe";
  }
  return process.env.SHELL || "/bin/bash";
}

// ── Cross-platform process kill ─────────────────────────────────────────
function killProcess(proc) {
  if (!proc || !proc.pid || proc.killed) return;
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/F", "/T", "/PID", String(proc.pid)], { stdio: "ignore" }).unref();
    } else {
      process.kill(proc.pid, "SIGTERM");
    }
  } catch {}
}

// ── SIGHUP detach (Unix-only, used with tmux) ──────────────────────────
function sighupProcess(proc) {
  try {
    if (proc && proc.pid && !proc.killed) {
      process.kill(proc.pid, "SIGHUP");
    }
  } catch {}
}

// ── Graceful shutdown ───────────────────────────────────────────────────
function gracefulShutdown(signal) {
  console.log(`[server] ${signal} received — killing ${activePtyProcesses.size} terminal processes...`);
  for (const [ws, entry] of activePtyProcesses) {
    killProcess(entry.ptyProc);
    try { ws.close(); } catch {}
  }
  activePtyProcesses.clear();
  setTimeout(() => process.exit(0), 2000);
}
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("uncaughtException", (err) => {
  console.error("[server] Uncaught exception (continuing):", err && err.stack || err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[server] Unhandled rejection (continuing):", reason);
});

// Try to load node-pty (optional)
let pty = null;
try {
  pty = require("node-pty");
  console.log("[terminal] node-pty loaded — full PTY mode enabled");
} catch {
  console.log("[terminal] node-pty not available — using spawn fallback");
}

// ── Auto-detect tmux availability ───────────────────────────────────────
let hasTmux = false;
if (process.platform !== "win32") {
  try {
    const which = spawn.sync ? spawn.spawnSync : require("child_process").spawnSync;
    const result = (which || execSync)("which", ["tmux"], { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
    hasTmux = !!(result.stdout || "").trim() && (result.status === 0 || result.status === undefined);
  } catch {
    try {
      execSync("which tmux", { encoding: "utf-8", stdio: "pipe" });
      hasTmux = true;
    } catch { hasTmux = false; }
  }
}
console.log(`[terminal] tmux ${hasTmux ? "detected — session persistence enabled" : "not found — using direct shell"}`);

// ── Fast message parser — avoids expensive try/catch on every keystroke ──
function parseControl(str) {
  if (str.charCodeAt(0) !== 123) return null; // not '{'
  try {
    const msg = JSON.parse(str);
    if (msg && typeof msg === "object" && msg.type) return msg;
  } catch {}
  return null;
}

// ── Session validation for WebSocket ────────────────────────────────────
// Reads the globalThis session store set by the Next.js auth routes
function validateWsCookie(req) {
  const cookieHeader = req.headers.cookie || "";
  const match = cookieHeader.match(/sofi_session=([^;]+)/);
  if (!match) return false;
  const token = match[1];
  const store = (globalThis).__sessionStore;
  if (!store) return false;
  const entry = store.get(token);
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) {
    store.delete(token);
    return false;
  }
  return true;
}

// ── Attach WebSocket handlers to any HTTP server ────────────────────────
function attachWebSockets(server) {
  const wssLocal = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const { pathname } = new URL(req.url, "http://localhost");
    console.log(`[ws] Upgrade request for: ${pathname}`);

    if (pathname === "/ws/terminal") {
      // Validate session cookie before upgrading
      if (!validateWsCookie(req)) {
        console.log("[ws] Rejected: no valid session");
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      wssLocal.handleUpgrade(req, socket, head, (ws) => {
        wssLocal.emit("connection", ws, req);
      });
    } else {
      socket.destroy();
    }
  });

  // ── Local PTY terminal ───────────────────────────────────────────────
  wssLocal.on("connection", (ws, req) => {
    console.log(`[ws] Terminal connection: ${req.url} (active: ${activePtyProcesses.size}/${MAX_CONCURRENT_SESSIONS})`);

    if (activePtyProcesses.size >= MAX_CONCURRENT_SESSIONS) {
      console.log(`[ws] Rejected: session limit reached (${MAX_CONCURRENT_SESSIONS})`);
      ws.send(`\r\n\x1b[31mSession limit reached (${MAX_CONCURRENT_SESSIONS}). Close other terminals first.\x1b[0m\r\n`);
      ws.close();
      return;
    }

    const searchParams = new URL(req.url, "http://localhost").searchParams;
    const rawProject = searchParams.get("project") || "";
    const project = rawProject.replace(/[^a-zA-Z0-9_.-]/g, "");
    const cols = parseInt(searchParams.get("cols") || "80", 10);
    const rows = parseInt(searchParams.get("rows") || "24", 10);
    const sessionName = (searchParams.get("session") || "").replace(/[^a-zA-Z0-9_-]/g, "") || "sofi_default";

    const cwd = project ? path.join(PROJECTS_ROOT, project) : PROJECTS_ROOT;
    if (!cwd.startsWith(PROJECTS_ROOT)) {
      ws.send("\r\nInvalid project path\r\n");
      ws.close();
      return;
    }
    if (!fs.existsSync(cwd)) fs.mkdirSync(cwd, { recursive: true });

    const env = { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor", FORCE_COLOR: "1" };
    const shell = getDefaultShell();

    // ── tmux available: session persistence (Unix only) ──────────────────
    if (hasTmux && pty) {
      let ptyProc;
      try {
        ptyProc = pty.spawn("tmux", [
          "new-session", "-A", "-s", sessionName, "-c", cwd
        ], { name: "xterm-256color", cols, rows, cwd, env });
        console.log(`[terminal] tmux session "${sessionName}" started (project: ${project || "root"})`);
      } catch (err) {
        ws.send(`\r\nFailed to start tmux: ${err.message}\r\n`);
        ws.close();
        return;
      }

      activePtyProcesses.set(ws, { ptyProc, sessionName, type: "pty" });

      let missedPongs = 0;
      ws.on("pong", () => { missedPongs = 0; });
      const pingInterval = setInterval(() => {
        if (missedPongs >= 2) { try { ws.terminate(); } catch {} clearInterval(pingInterval); return; }
        missedPongs++;
        try { ws.ping(); } catch {}
      }, 25_000);

      ptyProc.onData((data) => { if (ws.readyState === 1) ws.send(data); });
      ptyProc.onExit(({ exitCode }) => {
        activePtyProcesses.delete(ws);
        clearInterval(pingInterval);
        if (ws.readyState === 1) { ws.send(`\r\n[Session ended with code ${exitCode}]\r\n`); ws.close(); }
      });

      ws.on("message", (raw) => {
        const str = raw.toString();
        const ctrl = parseControl(str);
        if (ctrl) {
          if (ctrl.type === "resize") ptyProc.resize(Math.max(1, ctrl.cols || cols), Math.max(1, ctrl.rows || rows));
        } else {
          try { ptyProc.write(str); } catch {}
        }
      });

      // On WS close: SIGHUP detaches our tmux client, session persists
      ws.on("close", () => {
        activePtyProcesses.delete(ws);
        clearInterval(pingInterval);
        sighupProcess(ptyProc);
        console.log(`[terminal] Detached from tmux "${sessionName}" (active: ${activePtyProcesses.size})`);
      });
      return;
    }

    // ── No tmux: direct shell (no session persistence) ──────────────────
    if (pty) {
      let ptyProc;
      try {
        ptyProc = pty.spawn(shell, [], { name: "xterm-256color", cols, rows, cwd, env });
        console.log(`[terminal] Shell "${shell}" started (session: ${sessionName}, project: ${project || "root"})`);
      } catch (err) {
        ws.send(`\r\nFailed to start shell: ${err.message}\r\n`);
        ws.close();
        return;
      }

      activePtyProcesses.set(ws, { ptyProc, sessionName, type: "pty" });

      let missedPongs = 0;
      ws.on("pong", () => { missedPongs = 0; });
      const pingInterval = setInterval(() => {
        if (missedPongs >= 2) { try { ws.terminate(); } catch {} clearInterval(pingInterval); return; }
        missedPongs++;
        try { ws.ping(); } catch {}
      }, 25_000);

      ptyProc.onData((data) => { if (ws.readyState === 1) ws.send(data); });
      ptyProc.onExit(({ exitCode }) => {
        activePtyProcesses.delete(ws);
        clearInterval(pingInterval);
        if (ws.readyState === 1) { ws.send(`\r\n[Session ended with code ${exitCode}]\r\n`); ws.close(); }
      });

      ws.on("message", (raw) => {
        const str = raw.toString();
        const ctrl = parseControl(str);
        if (ctrl) {
          if (ctrl.type === "resize") ptyProc.resize(Math.max(1, ctrl.cols || cols), Math.max(1, ctrl.rows || rows));
        } else {
          try { ptyProc.write(str); } catch {}
        }
      });

      ws.on("close", () => {
        activePtyProcesses.delete(ws);
        clearInterval(pingInterval);
        killProcess(ptyProc);
        console.log(`[terminal] Killed shell for "${sessionName}" (active: ${activePtyProcesses.size})`);
      });
    } else {
      let proc;
      try {
        proc = spawn(shell, [], { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
      } catch (err) {
        ws.send(`\r\nFailed to start shell: ${err.message}\r\n`);
        ws.close();
        return;
      }

      activePtyProcesses.set(ws, { ptyProc: proc, sessionName, type: "spawn" });

      let missedPongs = 0;
      ws.on("pong", () => { missedPongs = 0; });
      const pingInterval = setInterval(() => {
        if (missedPongs >= 2) { try { ws.terminate(); } catch {} clearInterval(pingInterval); return; }
        missedPongs++;
        try { ws.ping(); } catch {}
      }, 25_000);

      let spawnBuffer = "";
      let spawnFlushTimer = null;
      const flushSpawnBuffer = () => {
        spawnFlushTimer = null;
        if (spawnBuffer && ws.readyState === 1) { ws.send(spawnBuffer); spawnBuffer = ""; }
      };
      const bufferSpawnOutput = (data) => { spawnBuffer += data.toString(); if (!spawnFlushTimer) spawnFlushTimer = setTimeout(flushSpawnBuffer, 8); };

      proc.stdout.on("data", bufferSpawnOutput);
      proc.stderr.on("data", bufferSpawnOutput);
      proc.on("close", (code) => {
        activePtyProcesses.delete(ws);
        clearInterval(pingInterval);
        if (ws.readyState === 1) { ws.send(`\r\n[Session ended with code ${code}]\r\n`); ws.close(); }
      });

      ws.on("message", (raw) => {
        const str = raw.toString();
        const ctrl = parseControl(str);
        if (!ctrl) { try { proc.stdin.write(str); } catch {} }
      });

      ws.on("close", () => {
        activePtyProcesses.delete(ws);
        clearInterval(pingInterval);
        killProcess(proc);
        console.log(`[terminal] Killed shell for "${sessionName}" (active: ${activePtyProcesses.size})`);
      });
    }
  });

  console.log("[ws] WebSocket terminal handlers attached");

  // ── Periodic health log ──────────────────────────────────────────────
  setInterval(() => {
    const mem = process.memoryUsage();
    const heapMB = (mem.heapUsed / 1024 / 1024).toFixed(1);
    const rssMB = (mem.rss / 1024 / 1024).toFixed(1);
    console.log(`[health] sessions: ${activePtyProcesses.size}/${MAX_CONCURRENT_SESSIONS} | heap: ${heapMB}MB | rss: ${rssMB}MB`);

    // Warning at 4GB, critical at 6GB (VPS has 8GB RAM)
    if (mem.rss > 6 * 1024 * 1024 * 1024) {
      console.warn(`[health] CRITICAL: RSS memory at ${rssMB}MB — close terminals NOW`);
    } else if (mem.rss > 4 * 1024 * 1024 * 1024) {
      console.warn(`[health] WARNING: RSS memory at ${rssMB}MB — consider closing terminals`);
    }
  }, 60_000);
}

// ── Start server ────────────────────────────────────────────────────────
if (dev) {
  // Development: use next() API directly
  const next = require("next");
  const app = next({ dev });
  app.prepare().then(() => {
    const handle = app.getRequestHandler();
    const server = http.createServer((req, res) => {
      handle(req, res, parse(req.url, true));
    });
    attachWebSockets(server);
    server.listen(port, "0.0.0.0", () => { console.log(`> Ready on http://0.0.0.0:${port}`); });
  });
} else {
  const standaloneManifest = path.join(__dirname, ".next", "required-server-files.json");
  if (fs.existsSync(standaloneManifest)) {
    // Production standalone: intercept http.createServer to capture the server,
    // then let Next.js startServer() do its thing
    process.chdir(__dirname);

    const origCreateServer = http.createServer.bind(http);
    http.createServer = function (...args) {
      const server = origCreateServer(...args);
      attachWebSockets(server);
      // Restore original so nothing else is affected
      http.createServer = origCreateServer;
      return server;
    };

    const nextConfig = JSON.parse(fs.readFileSync(standaloneManifest, "utf8")).config;
    process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(nextConfig);

    require("next");
    const { startServer } = require("next/dist/server/lib/start-server");

    startServer({
      dir: __dirname,
      isDev: false,
      config: nextConfig,
      hostname: "0.0.0.0",
      port: port,
      allowRetry: false,
    }).catch((err) => {
      console.error(err);
      process.exit(1);
    });
  } else {
    // Fallback: use next() API with production build (no standalone needed)
    console.log("[server] Standalone build not found — using next() API in production mode");
    const next = require("next");
    const app = next({ dev: false, dir: __dirname });
    app.prepare().then(() => {
      const handle = app.getRequestHandler();
      const server = http.createServer((req, res) => {
        handle(req, res, parse(req.url, true));
      });
      attachWebSockets(server);
      server.listen(port, "0.0.0.0", () => { console.log(`> Ready on http://localhost:${port} (production)`); });
    }).catch((err) => {
      console.error(err);
      process.exit(1);
    });
  }
}
