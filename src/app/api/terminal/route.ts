import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";
import path from "path";
import fs from "fs";
import { requireAuth } from "@/lib/requireAuth";

const PROJECTS_ROOT = path.join(process.cwd(), "projects");

export async function POST(req: NextRequest) {
  const deny = requireAuth(req);
  if (deny) return deny;

  const { command, project } = await req.json();

  if (!command || !command.trim()) {
    return NextResponse.json({ output: "" });
  }

  const cwd = project
    ? path.join(PROJECTS_ROOT, project)
    : PROJECTS_ROOT;

  if (!fs.existsSync(cwd)) {
    return NextResponse.json({ output: "Project directory not found.\n", exitCode: 1 });
  }

  // Handle clear command
  if (command.trim().toLowerCase() === "cls" || command.trim().toLowerCase() === "clear") {
    return NextResponse.json({ output: "\x1b[2J\x1b[H", exitCode: 0, isClear: true });
  }

  try {
    let result: string;
    if (process.platform === "win32") {
      result = execSync(
        `powershell.exe -NoProfile -Command "${command.replace(/"/g, '\\"')}"`,
        { cwd, encoding: "utf-8", timeout: 30000, stdio: ["pipe", "pipe", "pipe"] }
      );
    } else {
      result = execSync(command, {
        cwd, encoding: "utf-8", timeout: 30000, shell: "/bin/bash",
        stdio: ["pipe", "pipe", "pipe"],
      });
    }
    return NextResponse.json({ output: result || "", exitCode: 0 });
  } catch (e: any) {
    const output = (e.stdout || "") + (e.stderr || "") || e.message;
    const exitCode = e.status || 1;
    return NextResponse.json({ output, exitCode });
  }
}
