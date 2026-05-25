import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";
import { requireAuth } from "@/lib/requireAuth";

function killProcTree(proc: ReturnType<typeof spawn>) {
  if (!proc || !proc.pid) return;
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/F", "/T", "/PID", String(proc.pid)], { stdio: "ignore" }).unref();
    } else {
      process.kill(-proc.pid, "SIGKILL");
    }
  } catch {
    try { proc.kill("SIGKILL"); } catch {}
  }
}

const PROJECTS_ROOT = path.join(process.cwd(), "projects");

// Stores the claude session_id per conversation
const sessionIds = new Map<string, string>();

// Tracks the running claude process per conversation so kill actually terminates it.
// Without this, deleting a chat mid-stream left the process running on the server.
const activeProcesses = new Map<string, ReturnType<typeof spawn>>();

function killProcess(convId: string) {
  const proc = activeProcesses.get(convId);
  if (!proc) return;
  activeProcesses.delete(convId);
  killProcTree(proc);
}

const enc = (s: string) => new TextEncoder().encode(s);
const evt = (obj: object) => enc(JSON.stringify(obj) + "\n");

// Hard timeout per request: 30 minutes
const REQUEST_TIMEOUT_MS = 30 * 60 * 1000;

export async function POST(req: NextRequest) {
  const deny = requireAuth(req);
  if (deny) return deny;

  const body = await req.json();
  const { action, convId, message, model, mode, project, effort, sessionId: clientSessionId } = body;

  if (action === "kill") {
    killProcess(convId);
    sessionIds.delete(convId);
    return NextResponse.json({ ok: true });
  }

  if (action === "ping") {
    return NextResponse.json({ alive: sessionIds.has(convId) });
  }

  if (action === "send") {
    if (!convId || !message) {
      return NextResponse.json({ error: "Missing convId or message" }, { status: 400 });
    }

    const args = [
      "-p",
      "--output-format", "stream-json",
      "--verbose",
      "--include-partial-messages",
    ];

    if (model) args.push("--model", model);
    if (effort) args.push("--effort", effort);

    if (mode === "acceptEdits") {
      args.push("--permission-mode", "acceptEdits");
    } else if (mode === "bypassPermissions" || mode === "trustedBypass") {
      // Both --permission-mode bypassPermissions and --dangerously-skip-permissions are
      // blocked when running as root. Explicitly allow every known tool instead.
      // trustedBypass: same tool permissions as bypassPermissions but still uses --resume (context preserved)
      // bypassPermissions: manual retry after Allow click — skips --resume to force fresh tool execution
      args.push("--allowedTools",
        "Agent,Bash,Edit,Glob,Grep,MultiEdit,NotebookEdit,Read,Skill,ToolSearch,Write," +
        "WebFetch,WebSearch,AskUserQuestion,CronCreate,CronDelete,CronList," +
        "EnterPlanMode,ExitPlanMode,EnterWorktree,ExitWorktree,Monitor," +
        "PushNotification,RemoteTrigger,ScheduleWakeup," +
        "TaskCreate,TaskGet,TaskList,TaskOutput,TaskStop,TaskUpdate,TodoWrite"
      );
    }

    // Trim Claude's "I'm going to..." preamble so tool calls (and thus permission
    // popups) fire as early as possible.
    args.push(
      "--append-system-prompt",
      "Skip preamble. When a task needs tools, call them immediately without first describing what you'll do. Keep responses concise.",
    );

    // Skip --resume on the bypassPermissions retry: with the prior (denied) turn in
    // session history, Claude shortcuts to its adapted answer instead of actually
    // executing the now-allowed tools. Fresh session forces a real retry.
    // Prefer the client-supplied sessionId (persisted in localStorage) over the
    // in-memory Map so context survives server hot reloads and restarts.
    const existingSessionId = clientSessionId || sessionIds.get(convId);
    if (existingSessionId && mode !== "bypassPermissions") {
      args.push("--resume", existingSessionId);
    }

    const cwd = project
      ? path.join(PROJECTS_ROOT, path.basename(project))
      : process.cwd();

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let done = false;
        const t0 = Date.now();
        const ts = () => `+${((Date.now() - t0) / 1000).toFixed(2)}s`;
        console.log(`[AI] spawn start mode=${mode ?? "default"}`);
        function finish() {
          if (done) return;
          done = true;
          console.log(`[AI] finish ${ts()}`);
          controller.enqueue(evt({ t: "done" }));
          try { controller.close(); } catch {}
        }

        // If a previous run for this conv is somehow still alive (network blip
        // mid-stream, etc.), terminate it before starting a new one.
        killProcess(convId);

        let proc: ReturnType<typeof spawn>;
        try {
          // detached: true makes the spawned process a new process group leader.
          // We can then kill the whole group via process.kill(-pid) so children
          // spawned by skills/agents die with it.
          proc = spawn("claude", args, { stdio: ["pipe", "pipe", "pipe"], cwd, detached: true });
          activeProcesses.set(convId, proc);
          console.log(`[AI] process spawned pid=${proc.pid}`);
        } catch (e: any) {
          controller.enqueue(evt({ t: "error", v: e.message }));
          finish();
          return;
        }

        // Kill the process if it exceeds the timeout
        const timeout = setTimeout(() => {
          killProcess(convId);
          controller.enqueue(evt({ t: "error", v: "Request timed out" }));
          finish();
        }, REQUEST_TIMEOUT_MS);

        // Tools that require explicit user permission — text after their tool_use
        // is Claude's "I can't do that" fallback, which we suppress so the
        // permission card shows cleanly instead.
        // Tools that need explicit user permission. When the mode does NOT auto-allow
        // them, we cut the stream early: emit the chip + permission_request, then
        // suppress everything after (Claude's "I can't do that" fallback and any
        // adapted tool calls). In permissive modes (bypassPermissions/acceptEdits)
        // these tools execute normally, so we don't gate them.
        const PERMISSION_GATED = new Set(["WebSearch", "WebFetch", "Bash"]);
        const isPermissive = mode === "bypassPermissions" || mode === "trustedBypass";

        let buffer = "";
        const block = { type: "", name: "", id: "", inputJson: "" };
        let suppressAll = false;
        let gatedTriggerId = ""; // id of the gated tool_use that fired the popup

        proc.stdout?.on("data", (chunk: Buffer) => {
          if (done) return;
          buffer += chunk.toString();
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const e = JSON.parse(line);

              // Capture session_id as soon as it's available (system init is the
              // very first event). This lets the client retry with --resume even
              // if we kill the process mid-stream on a gated tool.
              if (e.type === "system" && e.subtype === "init" && e.session_id) {
                sessionIds.set(convId, e.session_id);
                controller.enqueue(evt({ t: "session_id", v: e.session_id }));
              }

              if (e.type === "stream_event") {
                const inner = e.event ?? {};

                if (inner.type === "content_block_start") {
                  const cb = inner.content_block ?? {};
                  block.type = cb.type ?? "";
                  block.name = cb.name ?? "";
                  block.id = cb.id ?? "";
                  block.inputJson = "";
                  console.log(`[AI] block_start ${ts()} type=${cb.type} name=${cb.name ?? "-"}`);

                  // Gated tool detected: kill the process immediately so it can't
                  // continue executing other tools (Write/Edit/etc) in the background
                  // while the user is staring at the permission popup.
                  if (cb.type === "tool_use" && !isPermissive && !suppressAll && PERMISSION_GATED.has(block.name)) {
                    console.log(`[AI] -> POPUP + KILL ${ts()} tool=${block.name}`);
                    controller.enqueue(evt({
                      t: "permission_request",
                      denial: { tool_name: block.name, tool_use_id: block.id, tool_input: {} },
                    }));
                    suppressAll = true;
                    gatedTriggerId = block.id;
                    killProcess(convId);
                    finish();
                    return;
                  }
                }

                if (inner.type === "content_block_delta") {
                  const delta = inner.delta ?? {};
                  if (delta.type === "thinking_delta" && delta.thinking) {
                    if (!suppressAll) controller.enqueue(evt({ t: "think", v: delta.thinking }));
                  } else if (delta.type === "text_delta" && delta.text) {
                    if (!suppressAll) controller.enqueue(evt({ t: "text", v: delta.text }));
                  } else if (delta.type === "input_json_delta") {
                    if (!block.inputJson) console.log(`[AI] first input_json_delta ${ts()} name=${block.name}`);
                    block.inputJson += delta.partial_json ?? "";
                  }
                }

                if (inner.type === "content_block_stop" && block.type === "tool_use") {
                  console.log(`[AI] block_stop ${ts()} name=${block.name}`);
                  let input: Record<string, unknown> = {};
                  try { input = JSON.parse(block.inputJson); } catch {}

                  const isInteractive = block.name === "AskUserQuestion" && !suppressAll;

                  // ToolSearch preloads deferred tool schemas. If it's loading a gated
                  // tool, fire the popup now — we know the exact tool name and this fires
                  // before the actual tool call.
                  let toolSearchTrigger: string | null = null;
                  if (block.name === "ToolSearch" && !isPermissive && !suppressAll) {
                    const q = String((input as any).query ?? "");
                    const m = q.match(/^select:\s*([^\s,]+(?:\s*,\s*[^\s,]+)*)/);
                    if (m) {
                      const wanted = m[1].split(",").map((s) => s.trim());
                      toolSearchTrigger = wanted.find((t) => PERMISSION_GATED.has(t)) ?? null;
                    }
                  }

                  if (!suppressAll || block.id === gatedTriggerId || isInteractive) {
                    controller.enqueue(evt({ t: "tool", name: block.name, input, id: block.id }));

                    if (block.id === gatedTriggerId) {
                      controller.enqueue(evt({
                        t: "permission_request",
                        denial: { tool_name: block.name, tool_use_id: block.id, tool_input: input },
                      }));
                    }
                  }

                  if (toolSearchTrigger) {
                    console.log(`[AI] -> POPUP + KILL (ToolSearch stop) ${ts()} tool=${toolSearchTrigger}`);
                    controller.enqueue(evt({
                      t: "permission_request",
                      denial: { tool_name: toolSearchTrigger, tool_use_id: block.id, tool_input: {} },
                    }));
                    suppressAll = true;
                    gatedTriggerId = block.id;
                    killProcess(convId);
                    finish();
                    return;
                  }

                  if (isInteractive) {
                    const questions = Array.isArray((input as any).questions) ? (input as any).questions : [];
                    controller.enqueue(evt({ t: "user_question", questions }));
                    suppressAll = true;
                  }

                  block.type = "";
                  block.id = "";
                  block.inputJson = "";
                }
              }

              if (e.type === "system" || e.type === "assistant" || e.type === "user") {
                console.log(`[AI] event type=${e.type} ${ts()}`);
              }

              // Capture tool_result blocks from Claude's user-role messages
              // (the Claude CLI emits a "user" role message containing tool_result
              // blocks after each tool finishes executing).
              if (e.type === "user" && e.message?.content && !suppressAll) {
                const content = e.message.content;
                if (Array.isArray(content)) {
                  for (const blk of content) {
                    if (blk?.type === "tool_result") {
                      let text = "";
                      if (typeof blk.content === "string") {
                        text = blk.content;
                      } else if (Array.isArray(blk.content)) {
                        text = blk.content
                          .map((c: any) => c?.text || (typeof c === "string" ? c : ""))
                          .filter(Boolean)
                          .join("\n");
                      }
                      controller.enqueue(evt({
                        t: "tool_result",
                        tool_use_id: blk.tool_use_id,
                        content: text,
                        is_error: !!blk.is_error,
                      }));
                    }
                  }
                }
              }

              if (e.type === "result") {
                console.log(`[AI] result ${ts()} is_error=${e.is_error}`);
                clearTimeout(timeout);
                // session_id was already captured from the system init event,
                // but re-send it here in case the result has a newer one (forked sessions).
                if (e.session_id && sessionIds.get(convId) !== e.session_id) {
                  sessionIds.set(convId, e.session_id);
                  controller.enqueue(evt({ t: "session_id", v: e.session_id }));
                }
                if (e.is_error && e.result) {
                  controller.enqueue(evt({ t: "error", v: String(e.result) }));
                }
                // Don't surface permission_denials in bypass mode — user already approved,
                // showing the card again would create an infinite loop.
                if (!isPermissive && Array.isArray(e.permission_denials) && e.permission_denials.length > 0) {
                  const denials = e.permission_denials.filter((d: any) => d?.tool_name !== "AskUserQuestion");
                  if (denials.length > 0) {
                    controller.enqueue(evt({ t: "permission_denials", denials }));
                  }
                }
                finish();
              }
            } catch {}
          }
        });

        let stderrBuf = "";
        proc.stderr?.on("data", (chunk: Buffer) => { stderrBuf += chunk.toString(); });

        proc.on("exit", (code) => {
          clearTimeout(timeout);
          activeProcesses.delete(convId);
          if (code !== 0 && stderrBuf.trim()) {
            controller.enqueue(evt({ t: "error", v: stderrBuf.trim() }));
          }
          finish();
        });

        proc.on("error", (err) => {
          clearTimeout(timeout);
          activeProcesses.delete(convId);
          controller.enqueue(evt({ t: "error", v: err.message }));
          finish();
        });

        try {
          proc.stdin?.write(message + "\n");
          proc.stdin?.end();
        } catch {}
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
      },
    });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
