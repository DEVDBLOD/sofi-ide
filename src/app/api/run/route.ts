import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { requireAuth } from "@/lib/requireAuth";

export async function POST(req: NextRequest) {
  const deny = requireAuth(req);
  if (deny) return deny;

  const { code, language } = await req.json();

  if (!code) {
    return NextResponse.json({ output: "No code provided.", error: true });
  }

  let ext = ".py";
  let cmd = process.platform === "win32" ? "python" : "python3";

  if (language === "javascript" || language === "typescript") {
    ext = ".js";
    cmd = "node";
  } else if (language === "python") {
    ext = ".py";
    cmd = process.platform === "win32" ? "python" : "python3";
  } else {
    return NextResponse.json({
      output: `Execution not supported for ${language} files`,
      error: false,
    });
  }

  const tmpFile = path.join(os.tmpdir(), `sofi_run_${Date.now()}${ext}`);

  try {
    fs.writeFileSync(tmpFile, code, "utf-8");
    const result = execSync(`${cmd} "${tmpFile}"`, {
      timeout: 10000,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return NextResponse.json({ output: result || "[No output]", error: false });
  } catch (e: any) {
    const output = (e.stdout || "") + (e.stderr || "") || e.message;
    return NextResponse.json({ output, error: true });
  } finally {
    try {
      fs.unlinkSync(tmpFile);
    } catch {}
  }
}
