import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import JSZip from "jszip";

const PROJECTS_ROOT = path.join(process.cwd(), "projects");
const SKIP = new Set(["node_modules", ".git", ".next", "__pycache__", ".venv", "venv"]);

function addDirToZip(zip: JSZip, dirPath: string, relativePath: string) {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP.has(entry.name)) continue;
    const fullPath = path.join(dirPath, entry.name);
    const relPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      addDirToZip(zip, fullPath, relPath);
    } else {
      try {
        zip.file(relPath, fs.readFileSync(fullPath));
      } catch {}
    }
  }
}

export async function GET(req: NextRequest) {
  const project = req.nextUrl.searchParams.get("project");

  if (!project) {
    return NextResponse.json({ error: "Missing project name" }, { status: 400 });
  }

  const safeName = project.replace(/[^a-zA-Z0-9_-]/g, "_");

  try {
    const projectDir = path.join(PROJECTS_ROOT, safeName);
    if (!fs.existsSync(projectDir)) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const zip = new JSZip();
    addDirToZip(zip, projectDir, "");

    if (Object.keys(zip.files).length === 0) {
      return NextResponse.json({ error: "Project is empty" }, { status: 400 });
    }

    const zipBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 1 } });

    return new NextResponse(new Uint8Array(zipBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${safeName}.zip"`,
        "Content-Length": String(zipBuffer.length),
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
