import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { requireAuth } from "@/lib/requireAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROJECTS_ROOT = path.join(process.cwd(), "projects");
const MAX_ZIP_SIZE = 2 * 1024 * 1024 * 1024; // 2GB
const UNZIP_TIMEOUT_MS = 5 * 60 * 1000; // 5 min

const SKIP_GLOBS = [
  "*/node_modules/*",
  "*node_modules/*",
  "*/.git/*",
  "*.git/*",
  "*/.next/*",
  "*.next/*",
  "*/__pycache__/*",
  "*__pycache__/*",
  "*/.venv/*",
  "*.venv/*",
  "*/venv/*",
];

function execAsync(cmd: string, args: string[], opts: { timeout?: number } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = exec([cmd, ...args.map((a) => `"${a.replace(/"/g, '\\"')}"`)].join(" "), {
      timeout: opts.timeout || UNZIP_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
    }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout);
    });
  });
}

export async function POST(req: NextRequest) {
  const deny = requireAuth(req);
  if (deny) return deny;

  const projectName = req.nextUrl.searchParams.get("name");
  const intoProject = req.nextUrl.searchParams.get("into");
  const intoFolder = req.nextUrl.searchParams.get("folder");

  // Either (name) for new project, or (into + folder) for existing
  const validName = (s: string | null) => !!s && /^[a-zA-Z0-9_.-]+$/.test(s);
  if (!validName(projectName) && !(validName(intoProject) && validName(intoFolder))) {
    return NextResponse.json({ error: "Invalid project name" }, { status: 400 });
  }
  if (!req.body) {
    return NextResponse.json({ error: "Empty body" }, { status: 400 });
  }

  fs.mkdirSync(PROJECTS_ROOT, { recursive: true });
  const tmpZip = path.join(PROJECTS_ROOT, `_import_${Date.now()}_${Math.random().toString(36).slice(2)}.zip`);
  const projectDir = intoProject
    ? path.join(PROJECTS_ROOT, intoProject!, intoFolder!)
    : path.join(PROJECTS_ROOT, projectName!);
  // Path-traversal guard
  const intoRoot = intoProject ? path.join(PROJECTS_ROOT, intoProject!) : PROJECTS_ROOT;
  if (!projectDir.startsWith(intoRoot)) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }
  fs.mkdirSync(projectDir, { recursive: true });

  // Stream upload to disk with size cap
  let written = 0;
  let aborted = false;
  const out = fs.createWriteStream(tmpZip);
  const nodeReadable = Readable.fromWeb(req.body as any);
  const limiter = new Readable({ read() {} });

  nodeReadable.on("data", (chunk: Buffer) => {
    if (aborted) return;
    written += chunk.length;
    if (written > MAX_ZIP_SIZE) {
      aborted = true;
      limiter.destroy(new Error("Zip exceeds limit"));
      return;
    }
    limiter.push(chunk);
  });
  nodeReadable.on("end", () => limiter.push(null));
  nodeReadable.on("error", (e) => limiter.destroy(e));

  try {
    await pipeline(limiter, out);
  } catch (err: any) {
    try { fs.unlinkSync(tmpZip); } catch {}
    const tooBig = aborted || /exceeds limit/i.test(err?.message || "");
    return NextResponse.json(
      { error: tooBig ? "Zip too large" : "Upload failed: " + err.message },
      { status: tooBig ? 413 : 500 }
    );
  }

  if (written === 0) {
    try { fs.unlinkSync(tmpZip); } catch {}
    return NextResponse.json({ error: "Empty file" }, { status: 400 });
  }

  // Extract with skip patterns
  try {
    if (process.platform === "win32") {
      // PowerShell can't filter on extract; expand then prune.
      await execAsync("powershell.exe", [
        "-NoProfile", "-Command",
        `Expand-Archive -Force -Path '${tmpZip}' -DestinationPath '${projectDir}'`,
      ]);
      for (const dir of ["node_modules", ".git", ".next", "__pycache__", ".venv", "venv"]) {
        try { fs.rmSync(path.join(projectDir, dir), { recursive: true, force: true }); } catch {}
      }
    } else {
      const args = ["-o", tmpZip, "-d", projectDir, "-x", ...SKIP_GLOBS];
      await execAsync("unzip", args);
    }

    // Flatten single-root-folder case
    const items = fs.readdirSync(projectDir);
    if (items.length === 1) {
      const single = path.join(projectDir, items[0]);
      if (fs.statSync(single).isDirectory()) {
        for (const item of fs.readdirSync(single)) {
          fs.renameSync(path.join(single, item), path.join(projectDir, item));
        }
        try { fs.rmdirSync(single); } catch {}
      }
    }

    try { fs.unlinkSync(tmpZip); } catch {}
    return NextResponse.json({ success: true, size: written });
  } catch (err: any) {
    try { fs.unlinkSync(tmpZip); } catch {}
    return NextResponse.json({ error: "Extract failed: " + err.message }, { status: 500 });
  }
}
