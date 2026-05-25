import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import { requireAuth } from "@/lib/requireAuth";

const SAFE_NAME = /^[a-zA-Z0-9_-]+$/;

function getActiveTerminals(): Map<any, { ptyProc: any; sessionName: string; type: string }> {
  return (globalThis as any).__activeTerminals || new Map();
}

function killProcess(proc: any) {
  if (!proc || !proc.pid || proc.killed) return;
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/F", "/T", "/PID", String(proc.pid)], { stdio: "ignore" }).unref();
    } else {
      process.kill(proc.pid, "SIGTERM");
    }
  } catch {}
}

function collectSessions() {
  const terminals = getActiveTerminals();
  const seen = new Map<string, { name: string; attached: boolean; windows: number; created: number }>();
  for (const [, entry] of terminals) {
    if (!seen.has(entry.sessionName)) {
      seen.set(entry.sessionName, {
        name: entry.sessionName,
        attached: true,
        windows: 1,
        created: Date.now(),
      });
    }
  }
  return Array.from(seen.values());
}

export async function GET(req: NextRequest) {
  const deny = requireAuth(req);
  if (deny) return deny;
  return NextResponse.json({ sessions: collectSessions() });
}

export async function PUT(req: NextRequest) {
  const deny = requireAuth(req);
  if (deny) return deny;

  const { oldName, newName } = await req.json();
  if (!oldName || !newName || typeof oldName !== "string" || typeof newName !== "string") {
    return NextResponse.json({ error: "Missing oldName or newName" }, { status: 400 });
  }

  const safeOld = oldName.replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeNew = newName.replace(/[^a-zA-Z0-9_-]/g, "_");
  if (!safeOld || !safeNew) {
    return NextResponse.json({ error: "Invalid name" }, { status: 400 });
  }

  const terminals = getActiveTerminals();
  for (const [, entry] of terminals) {
    if (entry.sessionName === safeOld) {
      entry.sessionName = safeNew;
    }
  }
  return NextResponse.json({ success: true, name: safeNew });
}

export async function DELETE(req: NextRequest) {
  const deny = requireAuth(req);
  if (deny) return deny;

  const { name } = await req.json();
  if (!name || typeof name !== "string") {
    return NextResponse.json({ error: "Missing session name" }, { status: 400 });
  }

  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "_");
  if (!safeName) {
    return NextResponse.json({ error: "Invalid name" }, { status: 400 });
  }

  const terminals = getActiveTerminals();
  const toDelete: any[] = [];
  for (const [ws, entry] of terminals) {
    if (entry.sessionName === safeName) {
      toDelete.push({ ws, entry });
    }
  }
  for (const { ws, entry } of toDelete) {
    killProcess(entry.ptyProc);
    try { ws.close(); } catch {}
    terminals.delete(ws);
  }
  return NextResponse.json({ success: true });
}
