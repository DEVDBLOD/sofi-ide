import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { requireAuth } from "@/lib/requireAuth";

const PROJECTS_ROOT = path.join(process.cwd(), "projects");

interface FileNode {
  id: string;
  name: string;
  type: "file" | "folder";
  language?: string;
  children?: string[];
  isOpen?: boolean;
}

const IMAGE_EXTS = new Set([
  "png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "ico", "avif", "tiff", "tif",
]);

function detectLang(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  if (IMAGE_EXTS.has(ext)) return "image";
  const map: Record<string, string> = {
    py: "python", ts: "typescript", tsx: "typescript",
    js: "javascript", jsx: "javascript", html: "html",
    css: "css", scss: "css", md: "markdown", json: "json",
  };
  return map[ext] || "plaintext";
}

/** Resolve and validate that a path stays inside the allowed root */
function safePath(root: string, userPath: string): string | null {
  const joined = path.join(root, userPath);
  const resolved = fs.existsSync(joined) ? fs.realpathSync(joined) : joined;
  if (!resolved.startsWith(fs.realpathSync(root))) return null;
  return resolved;
}

function scanProjectLocal(projectName: string, includeContents = false) {
  const root = path.join(PROJECTS_ROOT, projectName);
  if (!fs.existsSync(root))
    return { tree: {}, contents: {}, rootFiles: [], folderOpen: {} };

  const tree: Record<string, FileNode> = {};
  const contents: Record<string, string> = {};
  const folderOpen: Record<string, boolean> = {};

  function nodeId(p: string): string {
    const rel = path.relative(root, p).replace(/\\/g, "/");
    return rel || ".";
  }

  function scanDir(dirPath: string, depth: number) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return [];
    }

    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory())
        return a.isDirectory() ? -1 : 1;
      return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    });

    const children: string[] = [];

    const SKIP = new Set(["node_modules", ".git", ".next", "__pycache__", ".venv", "venv"]);
    for (const entry of entries) {
      if (SKIP.has(entry.name)) continue;
      const fullPath = path.join(dirPath, entry.name);

      // Skip symlinks pointing outside project root
      if (entry.isSymbolicLink()) {
        try {
          const real = fs.realpathSync(fullPath);
          if (!real.startsWith(fs.realpathSync(root))) continue;
        } catch { continue; }
      }

      const id = nodeId(fullPath);
      children.push(id);

      if (entry.isDirectory()) {
        const subChildren = scanDir(fullPath, depth + 1);
        tree[id] = {
          id,
          name: entry.name,
          type: "folder",
          children: subChildren,
          isOpen: false,
        };
        folderOpen[id] = false;
      } else {
        tree[id] = {
          id,
          name: entry.name,
          type: "file",
          language: detectLang(entry.name),
        };
        if (includeContents) {
          const ext = entry.name.split(".").pop()?.toLowerCase() || "";
          if (!IMAGE_EXTS.has(ext)) {
            try {
              const stat = fs.statSync(fullPath);
              if (stat.size < 300_000) {
                contents[id] = fs.readFileSync(fullPath, "utf-8");
              }
            } catch {}
          }
        }
      }
    }

    return children;
  }

  const rootChildren = scanDir(root, 0);

  tree["."] = {
    id: ".",
    name: projectName,
    type: "folder",
    children: rootChildren,
    isOpen: true,
  };
  folderOpen["."] = true;

  return { tree, contents, rootFiles: rootChildren, folderOpen };
}

// GET /api/files?project=xxx[&contents=1]
export async function GET(req: NextRequest) {
  const deny = requireAuth(req);
  if (deny) return deny;

  const project = req.nextUrl.searchParams.get("project");
  if (!project)
    return NextResponse.json({ error: "No project" }, { status: 400 });

  const includeContents = req.nextUrl.searchParams.get("contents") === "1";
  const result = scanProjectLocal(project, includeContents);
  return NextResponse.json(result);
}

// POST /api/files — create/write/rename/delete
export async function POST(req: NextRequest) {
  const deny = requireAuth(req);
  if (deny) return deny;

  const body = await req.json();
  const { action, project, filePath, content, newName, itemType, destPath } = body;

  if (!project) {
    return NextResponse.json({ error: "Invalid project" }, { status: 400 });
  }

  const root = path.join(PROJECTS_ROOT, project);
  if (!fs.existsSync(root)) {
    return NextResponse.json({ error: "Invalid project" }, { status: 400 });
  }

  try {
    if (action === "write") {
      const fullPath = safePath(root, filePath);
      if (!fullPath)
        return NextResponse.json({ error: "Invalid path" }, { status: 400 });
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content || "", "utf-8");
      return NextResponse.json({ success: true });
    }

    if (action === "create") {
      const fullPath = safePath(root, filePath);
      if (!fullPath)
        return NextResponse.json({ error: "Invalid path" }, { status: 400 });
      if (itemType === "folder") {
        fs.mkdirSync(fullPath, { recursive: true });
      } else {
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, "", "utf-8");
      }
      return NextResponse.json({ success: true });
    }

    if (action === "rename") {
      const oldPath = safePath(root, filePath);
      if (!oldPath)
        return NextResponse.json({ error: "Invalid path" }, { status: 400 });
      const dir = path.dirname(oldPath);
      const newPath = path.join(dir, newName);
      if (!newPath.startsWith(fs.realpathSync(root)))
        return NextResponse.json({ error: "Invalid path" }, { status: 400 });
      fs.renameSync(oldPath, newPath);
      return NextResponse.json({ success: true });
    }

    if (action === "move") {
      const oldFull = safePath(root, filePath);
      const newFull = safePath(root, destPath);
      if (!oldFull || !newFull)
        return NextResponse.json({ error: "Invalid path" }, { status: 400 });
      fs.mkdirSync(path.dirname(newFull), { recursive: true });
      fs.renameSync(oldFull, newFull);
      return NextResponse.json({ success: true });
    }

    if (action === "delete") {
      const fullPath = safePath(root, filePath);
      if (!fullPath || fullPath === fs.realpathSync(root))
        return NextResponse.json({ error: "Invalid path" }, { status: 400 });
      fs.rmSync(fullPath, { recursive: true, force: true });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: "Operation failed" }, { status: 500 });
  }
}
