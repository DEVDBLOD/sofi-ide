import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { requireAuth } from "@/lib/requireAuth";

export interface LintMarker {
  line: number;
  col: number;
  message: string;
  severity: "error" | "warning";
}

function parsePyflakes(output: string, tmpFile: string): LintMarker[] {
  const markers: LintMarker[] = [];
  const escapedPath = tmpFile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const lineRe = new RegExp(`^(?:${escapedPath}|<[^>]+>|/dev/stdin):(\\d+):(\\d+): (.+)$`);

  for (const line of output.split("\n")) {
    const m = line.match(lineRe);
    if (!m) continue;
    const [, lineStr, colStr, msg] = m;
    const isWarning = /^redefinition|^imported but unused|^local variable|^'[^']+' imported but unused/.test(msg);
    markers.push({
      line: parseInt(lineStr, 10),
      col: parseInt(colStr, 10),
      message: msg.trim(),
      severity: isWarning ? "warning" : "error",
    });
  }
  return markers;
}

export async function POST(req: NextRequest) {
  const deny = requireAuth(req);
  if (deny) return deny;

  const { code, language } = await req.json();
  if (!code || !language) return NextResponse.json({ markers: [] });

  const tmpFile = path.join(os.tmpdir(), `sofi_lint_${Date.now()}.py`);

  try {
    if (language === "python") {
      fs.writeFileSync(tmpFile, code, "utf-8");
      try {
        const pythonCmd = process.platform === "win32" ? "python" : "python3";
        execSync(`${pythonCmd} -m pyflakes "${tmpFile}"`, {
          timeout: 8000,
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
        });
        return NextResponse.json({ markers: [] });
      } catch (e: any) {
        const raw = (e.stdout || "") + (e.stderr || "");
        const markers = parsePyflakes(raw, tmpFile);
        return NextResponse.json({ markers });
      }
    }

    return NextResponse.json({ markers: [] });
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}
