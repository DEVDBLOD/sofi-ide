import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { requireAuth } from "@/lib/requireAuth";

const PROJECTS_ROOT = path.join(process.cwd(), "projects");
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

const IMAGE_MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  svg: "image/svg+xml", webp: "image/webp", bmp: "image/bmp", ico: "image/x-icon",
  avif: "image/avif", tiff: "image/tiff", tif: "image/tiff",
};

export async function GET(req: NextRequest) {
  const deny = requireAuth(req);
  if (deny) return deny;

  const project = req.nextUrl.searchParams.get("project");
  const filePath = req.nextUrl.searchParams.get("file");

  if (!project || !filePath) {
    return NextResponse.json({ error: "Missing project or file" }, { status: 400 });
  }

  try {
    const root = path.join(PROJECTS_ROOT, project);
    const fullPath = path.join(root, filePath);
    // Resolve symlinks and validate path stays inside project
    const resolved = fs.existsSync(fullPath) ? fs.realpathSync(fullPath) : fullPath;
    if (!resolved.startsWith(fs.realpathSync(root))) {
      return NextResponse.json({ error: "Invalid path" }, { status: 400 });
    }
    const ext = filePath.split(".").pop()?.toLowerCase() || "";
    if (IMAGE_MIME[ext]) {
      const buffer = fs.readFileSync(resolved);
      const dataUrl = `data:${IMAGE_MIME[ext]};base64,${buffer.toString("base64")}`;
      return NextResponse.json({ content: dataUrl });
    }
    const stat = fs.statSync(resolved);
    if (stat.size > MAX_FILE_SIZE) {
      return NextResponse.json({ content: null, tooLarge: true, size: stat.size });
    }
    const content = fs.readFileSync(resolved, "utf-8");
    return NextResponse.json({ content });
  } catch {
    return NextResponse.json({ content: "" });
  }
}
