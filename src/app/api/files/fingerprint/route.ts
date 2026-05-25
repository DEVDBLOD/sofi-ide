import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { requireAuth } from "@/lib/requireAuth";

const PROJECTS_ROOT = path.join(process.cwd(), "projects");
const SKIP = new Set(["node_modules", ".git", ".next", "__pycache__", ".venv", "venv"]);

function computeFingerprint(dirPath: string): string {
  const hash = crypto.createHash("md5");

  function scan(dir: string) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (SKIP.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      const rel = path.relative(dirPath, fullPath).replace(/\\/g, "/");

      if (entry.isDirectory()) {
        hash.update(`d:${rel}\n`);
        scan(fullPath);
      } else {
        hash.update(`f:${rel}\n`);
      }
    }
  }

  scan(dirPath);
  return hash.digest("hex");
}

export async function GET(req: NextRequest) {
  const deny = requireAuth(req);
  if (deny) return deny;

  const project = req.nextUrl.searchParams.get("project");
  if (!project)
    return NextResponse.json({ error: "No project" }, { status: 400 });

  const root = path.join(PROJECTS_ROOT, project);
  if (!fs.existsSync(root))
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const fingerprint = computeFingerprint(root);
  return NextResponse.json({ fingerprint });
}
