import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { requireAuth } from "@/lib/requireAuth";

const PROJECTS_ROOT = path.join(process.cwd(), "projects");

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  bmp: "image/bmp",
  ico: "image/x-icon",
  avif: "image/avif",
  tiff: "image/tiff",
  tif: "image/tiff",
};

export async function GET(req: NextRequest) {
  const deny = requireAuth(req);
  if (deny) return deny;

  const project = req.nextUrl.searchParams.get("project");
  const filePath = req.nextUrl.searchParams.get("file");

  if (!project || !filePath) {
    return new NextResponse("Missing params", { status: 400 });
  }

  try {
    const root = path.join(PROJECTS_ROOT, project);
    const fullPath = path.join(root, filePath);
    const resolved = fs.existsSync(fullPath) ? fs.realpathSync(fullPath) : fullPath;
    if (!resolved.startsWith(fs.realpathSync(root))) {
      return new NextResponse("Invalid path", { status: 400 });
    }
    const ext = filePath.split(".").pop()?.toLowerCase() || "";
    const mimeType = MIME[ext] || "application/octet-stream";
    const buffer = fs.readFileSync(resolved);
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": mimeType,
        "Cache-Control": "public, max-age=60",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
