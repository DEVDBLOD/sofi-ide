import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { requireAuth } from "@/lib/requireAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROJECTS_ROOT = path.join(process.cwd(), "projects");
const MAX_UPLOAD_SIZE = 500 * 1024 * 1024; // 500MB per file

export async function POST(req: NextRequest) {
  const deny = requireAuth(req);
  if (deny) return deny;

  const project = req.nextUrl.searchParams.get("project");
  const filePath = req.nextUrl.searchParams.get("path");

  if (!project || !filePath) {
    // Backwards-compat: also accept JSON body { project, filePath, content, encoding }
    const ctype = req.headers.get("content-type") || "";
    if (ctype.includes("application/json")) {
      return handleJsonFallback(req);
    }
    return NextResponse.json(
      { error: "Missing ?project= or ?path=" },
      { status: 400 }
    );
  }

  if (!req.body) {
    return NextResponse.json({ error: "Empty body" }, { status: 400 });
  }

  const root = path.join(PROJECTS_ROOT, project);
  const fullPath = path.join(root, filePath);
  const resolvedRoot = fs.existsSync(root) ? fs.realpathSync(root) : root;
  if (!fullPath.startsWith(resolvedRoot)) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  fs.mkdirSync(path.dirname(fullPath), { recursive: true });

  let written = 0;
  const out = fs.createWriteStream(fullPath);
  const nodeReadable = Readable.fromWeb(req.body as any);
  const limiter = new Readable({
    read() {},
  });
  // Stream with byte counting; abort if exceeds cap
  let aborted = false;
  nodeReadable.on("data", (chunk: Buffer) => {
    if (aborted) return;
    written += chunk.length;
    if (written > MAX_UPLOAD_SIZE) {
      aborted = true;
      limiter.destroy(new Error("File exceeds limit"));
      return;
    }
    limiter.push(chunk);
  });
  nodeReadable.on("end", () => limiter.push(null));
  nodeReadable.on("error", (e) => limiter.destroy(e));

  try {
    await pipeline(limiter, out);
    return NextResponse.json({ success: true, size: written });
  } catch (err: any) {
    try { fs.unlinkSync(fullPath); } catch {}
    const tooBig = aborted || /exceeds limit/i.test(err?.message || "");
    return NextResponse.json(
      { error: tooBig ? "File too large" : "Upload failed" },
      { status: tooBig ? 413 : 500 }
    );
  }
}

async function handleJsonFallback(req: NextRequest) {
  // Legacy JSON path — kept so existing callers still work.
  // Reads body up to MAX_UPLOAD_SIZE; rejects otherwise.
  const len = parseInt(req.headers.get("content-length") || "0", 10);
  if (len && len > MAX_UPLOAD_SIZE * 2) {
    return NextResponse.json({ error: "File too large" }, { status: 413 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { project, filePath, content, encoding } = body || {};
  if (!project || !filePath) {
    return NextResponse.json({ error: "Missing project or filePath" }, { status: 400 });
  }
  if (typeof content === "string" && content.length > MAX_UPLOAD_SIZE * 2) {
    return NextResponse.json({ error: "File too large" }, { status: 413 });
  }

  const root = path.join(PROJECTS_ROOT, project);
  const fullPath = path.join(root, filePath);
  const resolvedRoot = fs.existsSync(root) ? fs.realpathSync(root) : root;
  if (!fullPath.startsWith(resolvedRoot)) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });

  if (encoding === "base64") {
    const buffer = Buffer.from(content || "", "base64");
    fs.writeFileSync(fullPath, buffer);
  } else {
    fs.writeFileSync(fullPath, content || "", "utf-8");
  }
  return NextResponse.json({ success: true });
}
