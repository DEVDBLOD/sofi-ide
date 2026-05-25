import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { requireAuth } from "@/lib/requireAuth";

const PROJECTS_ROOT = path.join(process.cwd(), "projects");

function ensureRoot() {
  if (!fs.existsSync(PROJECTS_ROOT)) {
    fs.mkdirSync(PROJECTS_ROOT, { recursive: true });
  }
}

// Validate project name: only alphanumeric, dash, underscore, dot
function isValidName(name: string): boolean {
  return /^[a-zA-Z0-9_.-]+$/.test(name) && !name.includes("..");
}

// GET /api/projects — list projects
export async function GET(req: NextRequest) {
  const deny = requireAuth(req);
  if (deny) return deny;

  ensureRoot();
  const dirs = fs
    .readdirSync(PROJECTS_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  return NextResponse.json({ projects: dirs, source: "local" });
}

// POST /api/projects — create project
export async function POST(req: NextRequest) {
  const deny = requireAuth(req);
  if (deny) return deny;

  const { name } = await req.json();
  if (!name || typeof name !== "string" || !isValidName(name)) {
    return NextResponse.json({ error: "Invalid name" }, { status: 400 });
  }

  ensureRoot();
  const projectPath = path.join(PROJECTS_ROOT, name);
  if (!projectPath.startsWith(PROJECTS_ROOT)) {
    return NextResponse.json({ error: "Invalid name" }, { status: 400 });
  }
  fs.mkdirSync(projectPath, { recursive: true });
  return NextResponse.json({ success: true, source: "local" });
}

// DELETE /api/projects — delete project
export async function DELETE(req: NextRequest) {
  const deny = requireAuth(req);
  if (deny) return deny;

  const { name } = await req.json();
  if (!name || typeof name !== "string" || !isValidName(name)) {
    return NextResponse.json({ error: "Invalid name" }, { status: 400 });
  }

  const projectPath = path.join(PROJECTS_ROOT, name);
  if (!projectPath.startsWith(PROJECTS_ROOT) || projectPath === PROJECTS_ROOT) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }
  try {
    fs.rmSync(projectPath, { recursive: true, force: true });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Operation failed" }, { status: 500 });
  }
}
