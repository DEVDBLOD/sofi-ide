"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  List, Trash2, Send, Square, Loader2,
  Plus, Code2, ChevronDown, ChevronRight, Play,
  Unlock, MessageSquare,
} from "lucide-react";
import { FileIcon } from "@/components/FileIcon";
import { useIDEStore, type ChatMessage, type MessageSegment, type ToolCall, type ToolPermissionDenial, type UserQuestion } from "@/store/useIDEStore";

const PERM_TEXTS = {
  allowBtn: "Permit",
  dismissBtn: "Dismiss",
};

type ChatMode = "default" | "plan" | "acceptEdits";
type RunMode = ChatMode | "bypassPermissions" | "trustedBypass";

interface Props {
  width?: number;
  onToggleCode?: () => void;
  panelProjectName?: string; // multi-chat mode: this panel operates for a specific project
}

// ── Tool labels ────────────────────────────────────────────────────────────

const TOOL_LABEL: Record<string, string> = {
  Write: "WRITE", Edit: "EDIT", MultiEdit: "EDIT",
  Read: "READ", Bash: "BASH",
  Glob: "FIND", Grep: "GREP",
  NotebookEdit: "NOTEBOOK", WebFetch: "FETCH", WebSearch: "SEARCH",
  Agent: "AGENT", TodoWrite: "TODO", Skill: "SKILL",
  ToolSearch: "SCHEMA", AskUserQuestion: "ASK",
};
const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit", "Bash"]);

function extractPath(input: Record<string, unknown>): string {
  return (
    (input.file_path as string) ||
    (input.path as string) ||
    (input.command as string) ||
    (input.query as string) ||
    (input.pattern as string) || ""
  );
}

function formatTs(ts?: number): string {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toTimeString().slice(0, 8);
}

function shortPath(raw: string): string {
  if (!raw) return "";
  const parts = raw.replace(/^\/+/, "").split("/");
  return parts.length > 3 ? "…/" + parts.slice(-3).join("/") : raw;
}

// ── Code renderer (for ``` blocks in AI replies) ───────────────────────────

function CodeBlock({ code, language }: { code: string; language?: string }) {
  return (
    <div className="my-2 overflow-hidden border" style={{ background: "#050505", borderColor: "rgba(245,245,245,0.08)" }}>
      {language && (
        <div className="flex items-center px-3 py-1 border-b" style={{ borderColor: "rgba(245,245,245,0.06)" }}>
          <span className="font-mono text-[9px] uppercase tracking-[0.22em]" style={{ color: "rgba(245,245,245,0.4)" }}>{language}</span>
        </div>
      )}
      <pre className="px-3 py-2.5 font-mono text-[11.5px] leading-[1.65] overflow-x-auto whitespace-pre-wrap break-words" style={{ color: "rgba(245,245,245,0.85)" }}>
        {code}
      </pre>
    </div>
  );
}

function MessageText({ content }: { content: string }) {
  const parts = content.split(/(```[\s\S]*?```)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("```")) {
          const nl = part.indexOf("\n");
          const lang = nl > 0 ? part.slice(3, nl).trim() : "";
          const code = nl > 0 ? part.slice(nl + 1, -3) : part.slice(3, -3);
          return <CodeBlock key={i} code={code} language={lang || undefined} />;
        }
        const inlineParts = part.split(/(`[^`]+`)/g);
        return (
          <span key={i} className="whitespace-pre-wrap break-words">
            {inlineParts.map((ip, j) => {
              if (ip.startsWith("`") && ip.endsWith("`") && ip.length > 2) {
                return (
                  <code key={j} className="px-1 py-px mx-px font-mono text-[11px] border" style={{ background: "rgba(255,255,255,0.04)", borderColor: "rgba(245,245,245,0.08)", color: "#ffffff" }}>
                    {ip.slice(1, -1)}
                  </code>
                );
              }
              return <span key={j}>{ip}</span>;
            })}
          </span>
        );
      })}
    </>
  );
}

// ── Thinking block ─────────────────────────────────────────────────────────

function ThinkingBlock({ thinking, isLive }: { thinking: string; isLive: boolean }) {
  const [open, setOpen] = useState(isLive);
  // Auto-open while thinking is being streamed
  useEffect(() => { if (isLive) setOpen(true); }, [isLive]);

  const words = thinking.trim().split(/\s+/).length;

  return (
    <div className="mb-2">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-[0.22em] mb-1"
        style={{ color: isLive ? "#ffffff" : "rgba(245,245,245,0.55)" }}
      >
        {open ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
        Thinking
        <span style={{ color: "rgba(245,245,245,0.3)" }}>·</span>
        <span style={{ color: "rgba(245,245,245,0.45)" }}>{words} words</span>
        {isLive && (
          <span
            className="w-1 h-1 rounded-full ml-1"
            style={{ background: "#ffffff", boxShadow: "0 0 6px rgba(255,255,255,0.6)", animation: "pulse-amber 1.8s ease-in-out infinite" }}
          />
        )}
      </button>
      {open && (
        <div
          className="font-serif italic pl-3 whitespace-pre-wrap break-words"
          style={{
            color: "rgba(245,245,245,0.62)",
            fontSize: 12.5,
            lineHeight: 1.5,
            borderLeft: "2px solid rgba(255,255,255,0.18)",
            wordBreak: "break-word",
            overflowWrap: "anywhere",
          }}
        >
          {thinking}
        </div>
      )}
    </div>
  );
}

// ── Tool input pretty-renderer ─────────────────────────────────────────────

function ToolInputView({ tool }: { tool: ToolCall }) {
  const input = tool.input || {};
  const name = tool.name;

  // Per-tool specific formatting
  if (name === "Bash") {
    return (
      <div className="space-y-1.5">
        {input.description ? (
          <div className="font-serif italic text-[12px]" style={{ color: "rgba(245,245,245,0.6)" }}>
            {String(input.description)}
          </div>
        ) : null}
        <pre className="font-mono text-[11.5px] leading-[1.55] whitespace-pre-wrap break-all p-2 overflow-x-auto"
          style={{ background: "#050505", color: "#ffffff", border: "1px solid rgba(245,245,245,0.06)" }}>
          $ {String(input.command ?? "")}
        </pre>
        {input.timeout ? (
          <div className="font-mono text-[9.5px] uppercase tracking-[0.18em]" style={{ color: "rgba(245,245,245,0.4)" }}>
            timeout · {String(input.timeout)}ms
          </div>
        ) : null}
      </div>
    );
  }

  if (name === "Read") {
    return (
      <KVList items={[
        ["file_path", String(input.file_path ?? "")],
        input.offset != null ? ["offset", String(input.offset)] : null,
        input.limit  != null ? ["limit",  String(input.limit)]  : null,
      ].filter(Boolean) as [string, string][]} />
    );
  }

  if (name === "Edit" || name === "MultiEdit") {
    const edits: any[] = Array.isArray(input.edits) ? input.edits : [{ old_string: input.old_string, new_string: input.new_string }];
    return (
      <div className="space-y-2">
        <KVList items={[["file_path", String(input.file_path ?? "")]]} />
        {edits.map((ed: any, i: number) => (
          <div key={i} className="space-y-0.5">
            <pre className="font-mono text-[11px] leading-[1.5] whitespace-pre-wrap p-2 overflow-x-auto"
              style={{ background: "rgba(212,95,106,0.08)", color: "rgba(245,245,245,0.85)", borderLeft: "2px solid #d45f6a" }}>
              {String(ed.old_string ?? "")}
            </pre>
            <pre className="font-mono text-[11px] leading-[1.5] whitespace-pre-wrap p-2 overflow-x-auto"
              style={{ background: "rgba(90,158,114,0.08)", color: "rgba(245,245,245,0.92)", borderLeft: "2px solid #5a9e72" }}>
              {String(ed.new_string ?? "")}
            </pre>
          </div>
        ))}
      </div>
    );
  }

  if (name === "Write") {
    const content = String(input.content ?? "");
    return (
      <div className="space-y-2">
        <KVList items={[["file_path", String(input.file_path ?? "")]]} />
        <pre className="font-mono text-[11px] leading-[1.5] whitespace-pre-wrap p-2 overflow-x-auto max-h-60 overflow-y-auto"
          style={{ background: "#050505", color: "rgba(245,245,245,0.85)", border: "1px solid rgba(245,245,245,0.06)" }}>
          {content || "(empty)"}
        </pre>
      </div>
    );
  }

  if (name === "Glob" || name === "Grep") {
    return (
      <KVList items={[
        ["pattern", String(input.pattern ?? "")],
        input.path   ? ["path", String(input.path)] : null,
        input.type   ? ["type", String(input.type)] : null,
        input.output_mode ? ["mode", String(input.output_mode)] : null,
      ].filter(Boolean) as [string, string][]} />
    );
  }

  if (name === "WebSearch") {
    return <KVList items={[["query", String(input.query ?? "")]]} />;
  }

  if (name === "WebFetch") {
    return (
      <KVList items={[
        ["url", String(input.url ?? "")],
        input.prompt ? ["prompt", String(input.prompt)] : null,
      ].filter(Boolean) as [string, string][]} />
    );
  }

  if (name === "TodoWrite") {
    const todos: any[] = Array.isArray(input.todos) ? input.todos : [];
    return (
      <ol className="space-y-1">
        {todos.map((td: any, i: number) => {
          const status = String(td?.status || "pending");
          const mark = status === "completed" ? "✓" : status === "in_progress" ? "●" : "○";
          const color = status === "completed" ? "#5a9e72" : status === "in_progress" ? "#ffffff" : "rgba(245,245,245,0.5)";
          return (
            <li key={i} className="grid gap-2 items-baseline" style={{ gridTemplateColumns: "12px 1fr" }}>
              <span className="font-mono text-[10px]" style={{ color }}>{mark}</span>
              <span className="font-serif text-[12.5px]" style={{ color: "rgba(245,245,245,0.85)" }}>{String(td.content ?? "")}</span>
            </li>
          );
        })}
      </ol>
    );
  }

  // Fallback — pretty-print JSON
  return (
    <pre className="font-mono text-[11px] leading-[1.55] whitespace-pre-wrap break-all p-2 overflow-x-auto"
      style={{ background: "#050505", color: "rgba(245,245,245,0.85)", border: "1px solid rgba(245,245,245,0.06)" }}>
      {JSON.stringify(input, null, 2)}
    </pre>
  );
}

function KVList({ items }: { items: [string, string][] }) {
  return (
    <div className="space-y-0.5">
      {items.map(([k, v], i) => (
        <div key={i} className="grid gap-3 items-baseline" style={{ gridTemplateColumns: "80px minmax(0,1fr)" }}>
          <span className="font-mono text-[9.5px] uppercase tracking-[0.18em]" style={{ color: "rgba(245,245,245,0.4)" }}>{k}</span>
          <span className="font-mono text-[11.5px] break-all" style={{ color: "rgba(245,245,245,0.9)", wordBreak: "break-all" }}>{v}</span>
        </div>
      ))}
    </div>
  );
}

// ── Result viewer with truncation ──────────────────────────────────────────

function ToolResultView({ result, isError }: { result: string; isError: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const CAP = 1200;
  const truncated = result.length > CAP && !expanded;
  const shown = truncated ? result.slice(0, CAP) : result;
  const lines = result.split("\n").length;

  return (
    <div className="space-y-1">
      <pre
        className="font-mono text-[11px] leading-[1.55] whitespace-pre-wrap break-all p-2 overflow-x-auto max-h-72 overflow-y-auto"
        style={{
          background: "#050505",
          color: isError ? "rgba(212,95,106,0.92)" : "rgba(245,245,245,0.85)",
          border: `1px solid ${isError ? "rgba(212,95,106,0.2)" : "rgba(245,245,245,0.06)"}`,
        }}
      >
        {shown}{truncated ? "\n…" : ""}
      </pre>
      {result.length > CAP && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="font-mono text-[9.5px] uppercase tracking-[0.22em]"
          style={{ color: "rgba(245,245,245,0.6)" }}
        >
          {expanded ? "↑ collapse" : `↓ show all · ${lines} lines · ${result.length} bytes`}
        </button>
      )}
    </div>
  );
}

// ── Tool log row — bordered chip with name + target + meta ─────────────────

function ToolChip({ tool, running }: { tool: ToolCall; running: boolean }) {
  const [open, setOpen] = useState(false);
  const label = TOOL_LABEL[tool.name] ?? tool.name.toUpperCase().slice(0, 8);
  const raw = extractPath(tool.input);
  const display = shortPath(raw);
  const hasResult = !!tool.result || tool.isError;
  const elapsed = tool.ts && tool.doneTs ? ((tool.doneTs - tool.ts) / 1000).toFixed(2) + "s" : null;

  return (
    <div className="min-w-0">
      {/* Header — clickable */}
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center flex-wrap gap-x-2 gap-y-1 min-w-0 text-left transition-colors py-[1px]"
        style={{ color: "inherit" }}
      >
        <span className="font-mono text-[9px] shrink-0" style={{ color: "rgba(245,245,245,0.4)" }}>
          {open ? "▾" : "▸"}
        </span>
        <span
          className="font-mono uppercase tracking-[0.15em] px-1.5 py-[1px] shrink-0"
          style={{
            color: tool.isError ? "#d45f6a" : "#ffffff",
            border: `1px solid ${tool.isError ? "rgba(212,95,106,0.5)" : "rgba(255,255,255,0.35)"}`,
            fontSize: 9.5,
          }}
        >
          {label}
        </span>
        {display && (
          <span
            className="font-mono text-[11px] truncate min-w-0"
            style={{ color: "rgba(245,245,245,0.85)" }}
            title={raw}
          >
            {display}
          </span>
        )}
        {running ? (
          <span className="font-mono text-[9px] uppercase tracking-[0.22em] inline-flex items-center gap-1.5 shrink-0 ml-auto" style={{ color: "#ffffff" }}>
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: "#ffffff", boxShadow: "0 0 8px rgba(255,255,255,0.6)", animation: "pulse-amber 1.8s ease-in-out infinite" }}
            />
            running
          </span>
        ) : tool.isError ? (
          <span className="font-mono text-[9px] uppercase tracking-[0.22em] shrink-0 ml-auto" style={{ color: "#d45f6a" }}>
            error{elapsed ? ` · ${elapsed}` : ""}
          </span>
        ) : hasResult ? (
          <span className="font-mono text-[9px] uppercase tracking-[0.22em] shrink-0 ml-auto" style={{ color: "rgba(90,158,114,0.85)" }}>
            done{elapsed ? ` · ${elapsed}` : ""}
          </span>
        ) : (
          <span className="font-mono text-[9px] uppercase tracking-[0.22em] shrink-0 ml-auto" style={{ color: "rgba(245,245,245,0.4)" }}>
            queued
          </span>
        )}
      </button>

      {/* Expanded details */}
      {open && (
        <div className="mt-1.5 mb-1 pl-3 space-y-2 animate-fade-in" style={{ borderLeft: "1px solid rgba(245,245,245,0.08)" }}>
          {/* Input */}
          <div>
            <div className="font-mono text-[8.5px] uppercase tracking-[0.32em] mb-1" style={{ color: "rgba(245,245,245,0.35)" }}>
              ── input
            </div>
            <ToolInputView tool={tool} />
          </div>

          {/* Result */}
          {(tool.result || tool.isError) && (
            <div>
              <div className="font-mono text-[8.5px] uppercase tracking-[0.32em] mb-1" style={{ color: "rgba(245,245,245,0.35)" }}>
                ── {tool.isError ? "error" : "output"}
              </div>
              <ToolResultView result={tool.result ?? ""} isError={!!tool.isError} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Mode config ────────────────────────────────────────────────────────────

const MODES: { value: ChatMode; label: string; hint: string }[] = [
  { value: "default",     label: "Ask",   hint: "Read-only" },
  { value: "plan",        label: "Plan",  hint: "Plan, then apply" },
  { value: "acceptEdits", label: "Agent", hint: "Direct edits" },
];

// ── Main ───────────────────────────────────────────────────────────────────

export default function ChatPanel({ width, onToggleCode, panelProjectName }: Props) {
  const [aiInput, setAiInput] = useState("");

  const {
    aiModel, setAiModel,
    aiEffort, setAiEffort,
    loadingConvIds, setConvLoading,
    conversations, activeConversationId: _storeActiveConvId,
    activeConvByProject,
    newConversation, newConversationForProject, ensureConvForProject,
    switchConversation, deleteConversation,
    addMessageToConversation, updateLastMessageInConversation,
    appendTextSegmentToLastMessage,
    appendThinkingToLastMessage, addToolCallToLastMessage,
    setToolResultOnLastMessage,
    setPermissionDenialsOnLastMessage,
    setUserQuestionsOnLastMessage,
    trustedConvIds, trustConversation, untrustConversation,
    setConversationTitle, setConversationSessionId, fileTree, projectName: _storeProjectName,
    fileContents,
  } = useIDEStore();

  // In multi-panel mode, each panel operates for its own project independently.
  const projectName = panelProjectName ?? _storeProjectName;
  const activeConversationId = panelProjectName
    ? (activeConvByProject[panelProjectName] ?? "")
    : _storeActiveConvId;

  // Ensure a conversation exists for this panel's project on mount/project change.
  useEffect(() => {
    if (panelProjectName) ensureConvForProject(panelProjectName);
  }, [panelProjectName]); // eslint-disable-line react-hooks/exhaustive-deps

  // Loading state for the conversation currently in view. Stop button binds to
  // this so it accurately reflects whether the *visible* chat is streaming.
  const aiIsLoading = loadingConvIds.includes(activeConversationId);

  // Revert UI state
  const [revertTarget, setRevertTarget] = useState<{ convId: string; msgIdx: number } | null>(null);
  const [reverting, setReverting] = useState(false);

  const [showConvList, setShowConvList] = useState(false);
  const [chatMode, setChatMode] = useState<ChatMode>("default");
  const [atMention, setAtMention] = useState<{ query: string; start: number } | null>(null);
  const [atIndex, setAtIndex] = useState(0);
  const [liveTool, setLiveTool] = useState<{ name: string; path: string; startedAt: number } | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // runIds and abort controllers are per-conversation so parallel runs across
  // different projects don't trample each other's "is this still my run?" check.
  const runIdsRef = useRef<Map<string, number>>(new Map());
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());

  function nextRunId(convId: string): number {
    const map = runIdsRef.current;
    const next = (map.get(convId) ?? 0) + 1;
    map.set(convId, next);
    return next;
  }

  // Notify the user that the chat needs attention. Tries the OS-level browser
  // notification first (only works in secure contexts: HTTPS or localhost). On
  // HTTP it silently no-ops, so we always also flash the browser tab title —
  // that one works everywhere.
  function notify(title: string, body: string, convId: string) {
    if (typeof window === "undefined") return;
    const focused = typeof document !== "undefined" && document.hasFocus();
    const isActiveAndFocused = focused && convId === activeConversationId;

    // Tab flash and extra beep only make sense when the user isn't already here
    if (!isActiveAndFocused) {
      flashTitle(`[!] ${title}`);
      playBeep();
    }

    // OS notification always fires when permission is granted — even if the tab
    // is focused, the user opted in and expects the popup.
    const sendNotification = (reg?: ServiceWorkerRegistration) => {
      const opts: NotificationOptions = { body, tag: convId, icon: "/favicon.png" };
      if (reg) {
        reg.showNotification(title, opts).catch(() => { try { new Notification(title, opts); } catch {} });
      } else {
        try { new Notification(title, opts); } catch {}
      }
    };

    if ("Notification" in window && Notification.permission === "granted") {
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.ready.then(sendNotification).catch(() => sendNotification());
      } else {
        sendNotification();
      }
    } else if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().then((perm) => {
        if (perm !== "granted") return;
        if ("serviceWorker" in navigator) {
          navigator.serviceWorker.ready.then(sendNotification).catch(() => sendNotification());
        } else {
          sendNotification();
        }
      }).catch(() => {});
    }
  }

  // Short two-tone beep via Web Audio API. The AudioContext is cached and
  // unlocked once via user gesture (see unlockAudio below) — otherwise Chrome
  // creates it in "suspended" state and the beep is silent. We always call
  // resume() before scheduling so it survives background-tab throttling too.
  const audioCtxRef = useRef<AudioContext | null>(null);
  function getAudioCtx(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (audioCtxRef.current) return audioCtxRef.current;
    try {
      const Ctx = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
      if (!Ctx) return null;
      audioCtxRef.current = new Ctx();
      return audioCtxRef.current;
    } catch { return null; }
  }
  function playBeep() {
    const ctx = getAudioCtx();
    if (!ctx) return;
    try {
      // Background tabs auto-suspend the AudioContext on Chrome. resume() is
      // async but we don't await — calling it kicks the context back to
      // running and the scheduled oscillator plays as soon as it's live.
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g);
      g.connect(ctx.destination);
      o.type = "sine";
      const t0 = ctx.currentTime;
      o.frequency.setValueAtTime(880, t0);
      o.frequency.setValueAtTime(1320, t0 + 0.12);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.22, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
      o.start(t0);
      o.stop(t0 + 0.5);
    } catch {}
  }
  // Unlock the AudioContext on any user gesture (typing, clicking). Browsers
  // require this before audio can play, and silently swallow audio scheduled
  // before the unlock. We attach once on mount and tear down after the first
  // successful unlock.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const unlock = () => {
      const ctx = getAudioCtx();
      if (!ctx) return;
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
    window.addEventListener("pointerdown", unlock, { once: false });
    window.addEventListener("keydown", unlock, { once: false });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  // Title-bar attention flash. Keeps swapping the document title with an
  // attention-grabbing string until the user focuses the tab again, then
  // restores the original. Works on plain HTTP (unlike Notification API).
  const titleFlashRef = useRef<{ original: string; timer: number | null } | null>(null);
  function flashTitle(attn: string) {
    if (typeof document === "undefined") return;
    if (document.hasFocus()) return;
    const state = titleFlashRef.current ?? { original: document.title, timer: null };
    titleFlashRef.current = state;
    if (state.timer != null) window.clearInterval(state.timer);
    let toggle = false;
    state.timer = window.setInterval(() => {
      document.title = toggle ? state.original : attn;
      toggle = !toggle;
    }, 1000);
    document.title = attn;

    const onFocus = () => {
      const s = titleFlashRef.current;
      if (!s) return;
      if (s.timer != null) window.clearInterval(s.timer);
      document.title = s.original;
      titleFlashRef.current = null;
      window.removeEventListener("focus", onFocus);
    };
    window.addEventListener("focus", onFocus);
  }

  // Register service worker and ask for notification permission on first mount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (!liveTool) { setElapsed(0); return; }
    const id = setInterval(() => setElapsed((Date.now() - liveTool.startedAt) / 1000), 100);
    return () => clearInterval(id);
  }, [liveTool]);

  useEffect(() => { if (!aiIsLoading) setLiveTool(null); }, [aiIsLoading]);

  const allFiles = useMemo(() =>
    Object.values(fileTree).filter((n) => n.type === "file").sort((a, b) => a.id.localeCompare(b.id)),
  [fileTree]);

  const atSuggestions = useMemo(() => {
    if (!atMention) return [];
    const q = atMention.query.toLowerCase();
    return allFiles.filter((f) => f.id.toLowerCase().includes(q) || f.name.toLowerCase().includes(q)).slice(0, 9);
  }, [atMention, allFiles]);

  function detectAt(value: string, cursorPos: number) {
    const before = value.slice(0, cursorPos);
    const match = before.match(/@(\S*)$/);
    if (!match) return null;
    return { query: match[1], start: cursorPos - match[0].length };
  }
  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value;
    setAiInput(val);
    const pos = e.target.selectionStart ?? val.length;
    setAtMention(detectAt(val, pos));
    setAtIndex(-1);
  }
  function handleInputClick(e: React.MouseEvent<HTMLTextAreaElement>) {
    const pos = e.currentTarget.selectionStart ?? 0;
    setAtMention(detectAt(aiInput, pos));
    setAtIndex(-1);
  }
  function selectAtSuggestion(file: { id: string }) {
    if (!atMention) return;
    const before = aiInput.slice(0, atMention.start);
    const after = aiInput.slice(atMention.start + 1 + atMention.query.length);
    const inserted = before + "@" + file.id + " " + after;
    setAiInput(inserted);
    setAtMention(null);
    setTimeout(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      const pos = (before + "@" + file.id + " ").length;
      ta.focus();
      ta.setSelectionRange(pos, pos);
    }, 0);
  }

  const activeConv = conversations.find((c) => c.id === activeConversationId);
  const messages = activeConv?.messages ?? [];

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, [aiInput]);

  const runStream = useCallback(async (convId: string, message: string, overrideMode?: RunMode, isPermissionRetry = false, projectOverride?: string) => {
    const baseMode = overrideMode ?? chatMode;
    const isTrusted = trustedConvIds.includes(convId);
    const effectiveMode: RunMode = (isTrusted && baseMode === "default") ? "trustedBypass" : baseMode;
    const ac = new AbortController();
    abortControllersRef.current.set(convId, ac);
    const conv = conversations.find((c) => c.id === convId);
    const sessionId = conv?.sessionId;
    // Use the conversation's project, not the currently viewed project — so
    // resuming/streaming in a non-active conv targets the right working dir.
    const projectForRun = projectOverride ?? conv?.projectName ?? projectName;
    const res = await fetch("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: ac.signal,
      body: JSON.stringify({
        action: "send", convId, message,
        model: aiModel, effort: aiEffort, mode: effectiveMode, project: projectForRun,
        sessionId,
      }),
    });
    if (!res.ok || !res.body) throw new Error(await res.text().catch(() => "Unknown error"));
    addMessageToConversation(convId, {
      role: "assistant",
      content: "",
      fromEditMode: effectiveMode === "acceptEdits" || effectiveMode === "bypassPermissions" || effectiveMode === "trustedBypass",
      isPermissionRetry,
    });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let lineBuf = "";
    let hadAnyContent = false;
    const pendingDenials: ToolPermissionDenial[] = [];
    outer: while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      lineBuf += decoder.decode(value, { stream: true });
      const lines = lineBuf.split("\n");
      lineBuf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const e = JSON.parse(line);
          if (e.t === "text") {
            // Append as an ordered text segment so subsequent tool segments
            // render *after* this text — interleaved instead of bunched at top.
            appendTextSegmentToLastMessage(convId, e.v);
            hadAnyContent = true;
          }
          else if (e.t === "think") { appendThinkingToLastMessage(convId, e.v); }
          else if (e.t === "tool") {
            const ts = Date.now();
            addToolCallToLastMessage(convId, { name: e.name, input: e.input ?? {}, ts, id: e.id });
            if (convId === activeConversationId) {
              setLiveTool({ name: e.name, path: extractPath(e.input ?? {}), startedAt: ts });
            }
            hadAnyContent = true;
          }
          else if (e.t === "tool_result") {
            setToolResultOnLastMessage(convId, e.tool_use_id, e.content ?? "", !!e.is_error);
          }
          else if (e.t === "session_id") { setConversationSessionId(convId, e.v); }
          else if (e.t === "error") {
            appendTextSegmentToLastMessage(convId, `\nError: ${e.v}`);
            hadAnyContent = true;
          }
          else if (e.t === "user_question") {
            setUserQuestionsOnLastMessage(convId, Array.isArray(e.questions) ? e.questions : []);
            const convTitle = conversations.find((c) => c.id === convId)?.title ?? "Chat";
            notify(`AI needs an answer · ${convTitle}`, "Open the chat to respond", convId);
          }
          else if (e.t === "permission_request") {
            const idx = pendingDenials.findIndex(p => p.tool_use_id === e.denial.tool_use_id);
            if (idx >= 0) pendingDenials[idx] = e.denial;
            else pendingDenials.push(e.denial);
            setPermissionDenialsOnLastMessage(convId, [...pendingDenials]);
            const convTitle = conversations.find((c) => c.id === convId)?.title ?? "Chat";
            notify(`Permission needed · ${convTitle}`, `${e.denial.tool_name} is waiting for approval`, convId);
          }
          else if (e.t === "permission_denials") {
            for (const d of e.denials) {
              if (!pendingDenials.some(p => p.tool_use_id === d.tool_use_id)) pendingDenials.push(d);
            }
            if (pendingDenials.length) {
              setPermissionDenialsOnLastMessage(convId, [...pendingDenials]);
              const names = pendingDenials.map((p) => p.tool_name).join(", ");
              const convTitle = conversations.find((c) => c.id === convId)?.title ?? "Chat";
              notify(`Permission needed · ${convTitle}`, names, convId);
            }
          }
          else if (e.t === "done") {
            if (convId === activeConversationId) setLiveTool(null);
            const convTitle = conversations.find((c) => c.id === convId)?.title ?? "Chat";
            // On meaningful completion (real content, no pending permission popup):
            //  - Always play a beep, even if the user is staring at this conv —
            //    they explicitly asked to hear it when AI is done.
            //  - Title flash + browser Notification still suppressed when the
            //    user is already focused here (those are for getting attention
            //    back, which doesn't apply if they never left).
            if (hadAnyContent && pendingDenials.length === 0) {
              playBeep();
              notify(`AI finished · ${convTitle}`, "Tap to view the result", convId);
            }
            break outer;
          }
        } catch {}
      }
    }
  }, [chatMode, aiModel, aiEffort, projectName, trustedConvIds, conversations, activeConversationId, addMessageToConversation, appendTextSegmentToLastMessage, appendThinkingToLastMessage, addToolCallToLastMessage, setToolResultOnLastMessage, setPermissionDenialsOnLastMessage, setUserQuestionsOnLastMessage, setConversationSessionId]);

  const sendMessage = useCallback(async () => {
    const text = aiInput.trim();
    const convId = activeConversationId;
    if (!text || loadingConvIds.includes(convId)) return;
    const conv = conversations.find((c) => c.id === convId);
    if (conv?.messages.length === 0) {
      setConversationTitle(convId, text.slice(0, 40) + (text.length > 40 ? "…" : ""));
    }
    // Snapshot current file state — enables revert from this user message
    const snapshot: Record<string, string> = { ...fileContents };
    const snapshotFiles = Object.values(fileTree)
      .filter((n: any) => n.type === "file")
      .map((n: any) => n.id);
    addMessageToConversation(convId, { role: "user", content: text, snapshot, snapshotFiles });
    setAiInput("");
    const myRun = nextRunId(convId);
    setConvLoading(convId, true);
    try { await runStream(convId, text); }
    catch (e: any) { if (e?.name !== "AbortError") addMessageToConversation(convId, { role: "assistant", content: `Error: ${e.message}` }); }
    finally {
      if (runIdsRef.current.get(convId) === myRun) setConvLoading(convId, false);
    }
  }, [aiInput, loadingConvIds, activeConversationId, conversations, addMessageToConversation, setConversationTitle, setAiInput, setConvLoading, runStream, fileContents, fileTree]);

  const doRevert = useCallback(async () => {
    if (!revertTarget || reverting) return;
    const { convId, msgIdx } = revertTarget;
    const conv = conversations.find((c) => c.id === convId);
    const msg = conv?.messages[msgIdx];
    const snapshot = msg?.snapshot;
    if (!snapshot || !projectName) { setRevertTarget(null); return; }

    setReverting(true);
    try {
      // 1. Fetch current file tree to find files created AFTER the snapshot
      const treeRes = await fetch(`/api/files?project=${encodeURIComponent(projectName)}`);
      const treeData = await treeRes.json();
      const currentFiles: string[] = Object.values(treeData.tree || {})
        .filter((n: any) => n.type === "file")
        .map((n: any) => n.id);

      // 2. Compute which current files weren't there at snapshot time → delete them
      const snapshotFileSet = new Set(msg?.snapshotFiles ?? Object.keys(snapshot));
      const filesToDelete = currentFiles.filter((f) => !snapshotFileSet.has(f));

      await Promise.all(filesToDelete.map((filePath) =>
        fetch("/api/files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "delete", project: projectName, filePath }),
        }).catch(() => {})
      ));

      // 3. Write each snapshot file back to disk (restores content + recreates deleted ones)
      const entries = Object.entries(snapshot);
      await Promise.all(entries.map(([filePath, content]) =>
        fetch("/api/files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "write", project: projectName, filePath, content }),
        }).catch(() => {})
      ));

      // 4. Reload the project tree + contents
      const res = await fetch(`/api/files?project=${encodeURIComponent(projectName)}&contents=1`);
      const data = await res.json();
      useIDEStore.getState().loadProject(data.tree, data.contents, data.rootFiles, data.folderOpen);

      // 5. Mark the message as reverted (visual hint)
      useIDEStore.setState((s) => ({
        conversations: s.conversations.map((c) =>
          c.id !== convId ? c : {
            ...c,
            messages: c.messages.map((m, i) => i === msgIdx ? { ...m, reverted: true } : m),
          }
        ),
      }));
    } finally {
      setReverting(false);
      setRevertTarget(null);
    }
  }, [revertTarget, reverting, conversations, projectName]);

  const stopStream = useCallback(() => {
    const convId = activeConversationId;
    nextRunId(convId);
    abortControllersRef.current.get(convId)?.abort();
    abortControllersRef.current.delete(convId);
    fetch("/api/ai", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "kill", convId }),
    }).catch(() => {});
    setLiveTool(null);
    setConvLoading(convId, false);
  }, [activeConversationId, setConvLoading]);

  const allowPermissions = useCallback(async () => {
    const convId = activeConversationId;
    const conv = conversations.find((c) => c.id === convId);
    const visible = conv?.messages.filter((m) => !m.hidden) ?? [];
    // Resume the session with a targeted continuation so Claude picks up exactly
    // where it left off instead of re-thinking the original message from scratch.
    const lastAssistantMsg = [...visible].reverse().find((m) => m.role === "assistant");
    const denials = lastAssistantMsg?.permissionDenials ?? [];
    const denialNames = denials.map((d: ToolPermissionDenial) => d.tool_name).join(", ");
    const retryContent = denialNames
      ? `Permission granted for: ${denialNames}. Please continue your previous plan.`
      : ([...visible].reverse().find((m) => m.role === "user")?.content ?? "");
    if (!retryContent) return;
    const myRun = nextRunId(convId);
    abortControllersRef.current.get(convId)?.abort();
    try { await fetch("/api/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "kill", convId }) }); } catch {}
    setPermissionDenialsOnLastMessage(convId, []);
    trustConversation(convId);
    addMessageToConversation(convId, { role: "user", content: retryContent, hidden: true });
    setConvLoading(convId, true);
    // trustedBypass = --resume (keeps context) + --allowedTools (grants the tools)
    try { await runStream(convId, retryContent, "trustedBypass", true); }
    catch (e: any) { if (e?.name !== "AbortError") addMessageToConversation(convId, { role: "assistant", content: `Error: ${e.message}` }); }
    finally {
      if (runIdsRef.current.get(convId) === myRun) setConvLoading(convId, false);
    }
  }, [activeConversationId, conversations, addMessageToConversation, setPermissionDenialsOnLastMessage, trustConversation, setConvLoading, runStream]);

  const dismissPermissions = useCallback(() => {
    setPermissionDenialsOnLastMessage(activeConversationId, []);
  }, [activeConversationId, setPermissionDenialsOnLastMessage]);

  const answerUserQuestions = useCallback(async (answers: Record<string, string[]>) => {
    const convId = activeConversationId;
    if (loadingConvIds.includes(convId)) return;
    const formatted = Object.entries(answers).map(([q, picks]) => `• ${q} → ${picks.join(", ")}`).join("\n");
    const followUp = `My answer:\n${formatted}`;
    setUserQuestionsOnLastMessage(convId, []);
    addMessageToConversation(convId, { role: "user", content: followUp, hidden: true });
    const myRun = nextRunId(convId);
    setConvLoading(convId, true);
    try { await runStream(convId, followUp); }
    catch (e: any) { addMessageToConversation(convId, { role: "assistant", content: `Error: ${e.message}` }); }
    finally {
      if (runIdsRef.current.get(convId) === myRun) setConvLoading(convId, false);
    }
  }, [loadingConvIds, activeConversationId, addMessageToConversation, setConvLoading, runStream, setUserQuestionsOnLastMessage]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (atMention && atSuggestions.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setAtIndex((i) => i < 0 ? 0 : (i + 1) % atSuggestions.length); return; }
      if (e.key === "ArrowUp")   { e.preventDefault(); setAtIndex((i) => i < 0 ? atSuggestions.length - 1 : (i - 1 + atSuggestions.length) % atSuggestions.length); return; }
      if ((e.key === "Enter" || e.key === "Tab") && atIndex >= 0) { e.preventDefault(); selectAtSuggestion(atSuggestions[atIndex]); return; }
      if (e.key === "Escape")    { e.preventDefault(); setAtMention(null); return; }
    }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  }

  async function handleDeleteConversation(id: string) {
    // Stop any in-flight stream for this conv before dropping it from state —
    // otherwise the fetch reader keeps appending to a message in a deleted
    // conv (no visible effect, but burns tokens and CPU on the server).
    nextRunId(id);
    abortControllersRef.current.get(id)?.abort();
    abortControllersRef.current.delete(id);
    setConvLoading(id, false);
    try {
      await fetch("/api/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "kill", convId: id }) });
    } catch {}
    deleteConversation(id);
  }

  const visibleMessages = messages.filter((m) => !m.hidden);
  const lastMsg = visibleMessages[visibleMessages.length - 1];

  const lastDenials: ToolPermissionDenial[] = (lastMsg?.role === "assistant" && lastMsg.permissionDenials?.length) ? lastMsg.permissionDenials : [];
  const showPermissionCard = lastDenials.length > 0;
  const lastQuestions: UserQuestion[] = (lastMsg?.role === "assistant" && lastMsg.userQuestions?.length) ? lastMsg.userQuestions : [];
  const showQuestions = lastQuestions.length > 0;

  // Only show conversations for the currently open project. "" (empty
  // projectName) is treated as legacy/unscoped — those show up under whatever
  // the current project is so old chats don't disappear.
  const sortedConvs = [...conversations]
    .filter((c) => (c.projectName ?? "") === (projectName ?? "") || !(c.projectName))
    .sort((a, b) => b.createdAt - a.createdAt);
  const panelStyle: React.CSSProperties = width !== undefined
    ? { width, minWidth: width, maxWidth: width, flexShrink: 0 }
    : { flex: 1, minWidth: 0 };

  const isTrusted = trustedConvIds.includes(activeConversationId);

  // ── Conversation list ──────────────────────────────────────────────────
  if (showConvList) {
    return (
      <div className="flex flex-col overflow-hidden relative" style={{ ...panelStyle, background: "rgba(8,8,8,0.55)", borderLeft: "1px solid rgba(245,245,245,0.08)", backdropFilter: "blur(12px)" }}>
        <div className="flex items-center px-5 h-[50px] border-b shrink-0" style={{ borderColor: "rgba(245,245,245,0.06)" }}>
          <button onClick={() => setShowConvList(false)} className="btn-icon mr-1.5">
            <ChevronRight size={11} className="rotate-180" />
          </button>
          <span className="flex-1 font-mono text-[9px] uppercase tracking-[0.32em]" style={{ color: "#ffffff", fontWeight: 600 }}>
            conversations
          </span>
          <button onClick={() => { (panelProjectName ? newConversationForProject(panelProjectName) : newConversation()); setShowConvList(false); }} className="btn-icon" title="New">
            <Plus size={11} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {sortedConvs.map((conv) => {
            const isActive = conv.id === activeConversationId;
            const isStreaming = loadingConvIds.includes(conv.id);
            return (
              <div
                key={conv.id}
                onClick={() => { switchConversation(conv.id); setShowConvList(false); }}
                className="group relative flex items-center gap-2.5 px-5 py-2 cursor-pointer transition-colors"
                style={{ background: isActive ? "rgba(255,255,255,0.07)" : "transparent" }}
              >
                {isActive && <span className="absolute left-0 top-2 bottom-2 w-[2px]" style={{ background: "#ffffff" }} />}
                <MessageSquare size={10} style={{ color: isActive ? "#ffffff" : "rgba(245,245,245,0.5)" }} />
                <span className="flex-1 font-mono text-[11.5px] truncate" style={{ color: isActive ? "#ffffff" : "rgba(245,245,245,0.72)" }}>
                  {conv.title}
                </span>
                {isStreaming && (
                  <span
                    className="shrink-0 w-1.5 h-1.5 rounded-full"
                    style={{ background: "#ffffff", boxShadow: "0 0 8px rgba(255,255,255,0.6)", animation: "pulse-amber 1.8s ease-in-out infinite" }}
                    title="AI is working on this chat"
                  />
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); handleDeleteConversation(conv.id); }}
                  className="shrink-0 opacity-0 group-hover:opacity-100 btn-icon !w-5 !h-5"
                >
                  <Trash2 size={10} />
                </button>
              </div>
            );
          })}
          {sortedConvs.length === 0 && (
            <div className="px-5 py-8 font-mono text-[9px] uppercase tracking-[0.22em] text-center" style={{ color: "rgba(245,245,245,0.4)" }}>
              No entries
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Chat view ──────────────────────────────────────────────────────────
  return (
    <div
      className="flex flex-col overflow-hidden relative"
      style={{
        ...panelStyle,
        background: "rgba(8,8,8,0.55)",
        borderLeft: "1px solid rgba(245,245,245,0.08)",
        backdropFilter: "blur(12px)",
      }}
    >
      {/* ── Header: just control row ──────────────────────────────────── */}
      <div className="flex items-center px-3 h-9 border-b shrink-0 gap-1" style={{ borderColor: "rgba(245,245,245,0.06)" }}>
        <button onClick={() => setShowConvList(true)} className="btn-icon" title="Conversations">
          <List size={12} />
        </button>
        <button onClick={() => panelProjectName ? newConversationForProject(panelProjectName) : newConversation()} className="btn-icon" title="New">
          <Plus size={12} />
        </button>
        {onToggleCode && (
          <button onClick={onToggleCode} className="btn-icon" title="Toggle editor">
            <Code2 size={12} />
          </button>
        )}
        <span className="flex-1 ml-2 font-mono text-[10px] uppercase tracking-[0.18em] truncate" style={{ color: "rgba(245,245,245,0.5)" }}>
          {activeConv?.title || "new chat"}
        </span>
        {aiIsLoading && (
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: "#ffffff", boxShadow: "0 0 8px rgba(255,255,255,0.6)", animation: "pulse-amber 1.8s ease-in-out infinite" }}
          />
        )}
        {isTrusted && (
          <button onClick={() => untrustConversation(activeConversationId)} className="btn-icon" title="Revoke trust">
            <Unlock size={11} />
          </button>
        )}
      </div>

      {/* ── Log ──────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden py-2 min-h-0">
        {visibleMessages.length === 0 && !aiIsLoading && (
          <div className="px-3 py-3 font-mono text-[9px] uppercase tracking-[0.32em]" style={{ color: "rgba(245,245,245,0.3)" }}>
            ↳ waiting
          </div>
        )}

        {visibleMessages.map((msg, i, arr) => {
          const isLast = i === arr.length - 1;
          const ts = msg.role === "user" ? undefined : msg.toolCalls?.[0]?.ts;
          // Find this message's real index in the full conversation array
          const realIdx = messages.indexOf(msg);
          const canRevert = msg.role === "user" && !!msg.snapshot && !msg.reverted && !aiIsLoading;
          return (
            <LogEntry
              key={i}
              msg={msg}
              isLast={isLast}
              aiIsLoading={aiIsLoading}
              showThinking={chatMode !== "default"}
              ts={ts}
              canRevert={canRevert}
              onRevert={canRevert ? () => setRevertTarget({ convId: activeConversationId, msgIdx: realIdx }) : undefined}
            />
          );
        })}

        {/* User questions */}
        {showQuestions && (
          <div className="px-6 py-2.5">
            <UserQuestionsCard questions={lastQuestions} onAnswer={answerUserQuestions} />
          </div>
        )}

        {/* Permission card */}
        {showPermissionCard && (
          <div className="px-3 py-2.5 grid gap-2.5" style={{ gridTemplateColumns: "44px minmax(0,1fr)", borderBottom: "1px dashed rgba(245,245,245,0.05)" }}>
            <span className="font-mono text-[9px] tabular-nums pt-1.5" style={{ color: "rgba(245,245,245,0.35)" }}>—:—:—</span>
            <div className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-[9px] uppercase tracking-[0.22em]" style={{ color: "#ffffff" }}>permission</span>
                {lastDenials.map((d, i) => (
                  <span
                    key={i}
                    className="font-mono text-[9px] uppercase tracking-[0.15em] px-1.5 py-[1px]"
                    style={{ border: "1px solid rgba(255,255,255,0.28)", color: "rgba(245,245,245,0.75)" }}
                  >
                    {d.tool_name}
                  </span>
                ))}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={allowPermissions}
                  disabled={aiIsLoading}
                  className="font-mono text-[10px] uppercase tracking-[0.18em] px-2.5 py-1.5 disabled:opacity-50 disabled:cursor-wait"
                  style={{ background: "#ffffff", color: "#0a0a0a", fontWeight: 600 }}
                >
                  {aiIsLoading ? "aguardando…" : PERM_TEXTS.allowBtn}
                </button>
                <button
                  onClick={dismissPermissions}
                  className="font-mono text-[10px] uppercase tracking-[0.18em] px-2.5 py-1.5"
                  style={{ color: "rgba(245,245,245,0.5)", border: "1px solid rgba(255,255,255,0.15)" }}
                >
                  {PERM_TEXTS.dismissBtn}
                </button>
                {!aiIsLoading && (
                  <span className="font-serif italic text-[10.5px]" style={{ color: "rgba(245,245,245,0.35)" }}>
                    continues from here
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ── Input ────────────────────────────────────────────────────── */}
      <div className="border-t shrink-0" style={{ borderColor: "rgba(245,245,245,0.1)", background: "rgba(255,255,255,0.02)" }}>
        <div className="px-3 pt-3 pb-3 relative">
          {/* @ mention */}
          {atMention && atSuggestions.length > 0 && (
            <div className="absolute bottom-full left-3 right-3 mb-1.5 border z-50 overflow-hidden" style={{ background: "#0a0a0a", borderColor: "rgba(245,245,245,0.12)" }}>
              <div className="px-3 pt-1.5 pb-1 border-b" style={{ borderColor: "rgba(245,245,245,0.06)" }}>
                <span className="font-mono text-[9px] uppercase tracking-[0.22em]" style={{ color: "rgba(245,245,245,0.4)" }}>files</span>
              </div>
              <div className="overflow-y-auto" style={{ maxHeight: 200 }}>
                {atSuggestions.map((f, i) => {
                  const dir = f.id.includes("/") ? f.id.slice(0, f.id.lastIndexOf("/")) : "";
                  return (
                    <button
                      key={f.id}
                      onMouseDown={(e) => { e.preventDefault(); selectAtSuggestion(f); }}
                      className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left transition-colors"
                      style={{ background: i === atIndex ? "rgba(255,255,255,0.07)" : "transparent" }}
                    >
                      <FileIcon name={f.name} size={11} />
                      <div className="flex flex-col min-w-0 flex-1">
                        <span className="font-mono text-[11.5px] truncate" style={{ color: i === atIndex ? "#ffffff" : "rgba(245,245,245,0.72)" }}>{f.name}</span>
                        {dir && <span className="font-mono text-[10px] truncate" style={{ color: "rgba(245,245,245,0.4)" }}>{dir}/</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* prompt line with caret */}
          <div className="flex items-start gap-2 font-serif italic mb-2.5" style={{ color: "rgba(245,245,245,0.7)" }}>
            <span className="pt-1 shrink-0" style={{ color: "#ffffff", fontSize: 16 }}>›</span>
            <textarea
              ref={textareaRef}
              value={aiInput}
              onChange={handleInputChange}
              onClick={handleInputClick}
              onKeyDown={handleKeyDown}
              placeholder={
                chatMode === "acceptEdits" ? "write, build, anything…"
                : chatMode === "plan" ? "describe the plan…"
                : "ask, or @ a file…"
              }
              rows={1}
              disabled={aiIsLoading}
              className="flex-1 bg-transparent resize-none outline-none disabled:opacity-40 font-serif italic placeholder:opacity-50"
              style={{ color: "#ffffff", minHeight: 32, fontSize: 15, lineHeight: 1.5 }}
            />
          </div>

          {/* Toolbar: mode + model + effort + send.
             Single row. Mode + effort + send are shrink-0 so they keep their
             full size; only the model select gets to shrink (it has the
             longest labels). On narrow panels the model dropdown clips with
             an ellipsis instead of pushing the Send button onto its own line. */}
          <div className="flex items-center gap-1.5 min-w-0">
            <ModeSelector chatMode={chatMode} setChatMode={setChatMode} />

            <div className="relative flex-1 min-w-[40px]" style={{ minWidth: 40 }}>
              <select
                value={aiModel}
                onChange={(e) => setAiModel(e.target.value)}
                className="appearance-none bg-transparent pr-5 pl-2 outline-none cursor-pointer font-mono uppercase h-7 hover:bg-ide-hover transition-colors w-full truncate"
                style={{ color: "rgba(255,255,255,0.9)", fontSize: 10.5, letterSpacing: "0.12em", border: "1px solid rgba(245,245,245,0.08)", textOverflow: "ellipsis" }}
              >
                <optgroup label="Opus 4.7">
                  <option value="claude-opus-4-7[1m]">opus 4.7 · 1m</option>
                  <option value="claude-opus-4-7">opus 4.7</option>
                </optgroup>
                <optgroup label="Opus 4.6">
                  <option value="claude-opus-4-6[1m]">opus 4.6 · 1m</option>
                  <option value="claude-opus-4-6">opus 4.6</option>
                </optgroup>
                <optgroup label="Sonnet 4.6">
                  <option value="claude-sonnet-4-6[1m]">sonnet 4.6 · 1m</option>
                  <option value="claude-sonnet-4-6">sonnet 4.6</option>
                </optgroup>
                <optgroup label="Haiku 4.5">
                  <option value="claude-haiku-4-5-20251001">haiku 4.5</option>
                </optgroup>
              </select>
              <ChevronDown size={9} className="absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "rgba(245,245,245,0.5)" }} />
            </div>

            <div className="relative shrink-0">
              <select
                value={aiEffort}
                onChange={(e) => setAiEffort(e.target.value)}
                className="appearance-none bg-transparent pr-5 pl-2 outline-none cursor-pointer font-mono uppercase h-7 hover:bg-ide-hover transition-colors"
                style={{ color: "rgba(245,245,245,0.6)", fontSize: 10.5, letterSpacing: "0.12em", border: "1px solid rgba(245,245,245,0.08)" }}
              >
                <option value="low">low</option>
                <option value="medium">mid</option>
                <option value="high">high</option>
                <option value="xhigh">xhigh</option>
                <option value="max">max</option>
              </select>
              <ChevronDown size={9} className="absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "rgba(245,245,245,0.5)" }} />
            </div>

            {aiIsLoading ? (
              <button
                onClick={stopStream}
                className="font-mono uppercase tracking-[0.12em] inline-flex items-center gap-1.5 h-7 px-3 shrink-0 ml-auto"
                style={{ background: "#ffffff", color: "#0a0a0a", fontSize: 10.5, fontWeight: 700 }}
              >
                <Square size={9} fill="currentColor" strokeWidth={0} />
                Stop
              </button>
            ) : (
              <button
                onClick={sendMessage}
                disabled={!aiInput.trim()}
                className="font-mono uppercase tracking-[0.12em] inline-flex items-center gap-1.5 h-7 px-3 shrink-0 ml-auto disabled:opacity-30 disabled:cursor-not-allowed"
                style={{ background: "#ffffff", color: "#0a0a0a", fontSize: 10.5, fontWeight: 700 }}
              >
                Send
                <Send size={10} strokeWidth={2.4} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Revert confirmation modal ────────────────────────────────── */}
      {revertTarget && (() => {
        const conv = conversations.find((c) => c.id === revertTarget.convId);
        const msg = conv?.messages[revertTarget.msgIdx];
        const fileCount = msg?.snapshot ? Object.keys(msg.snapshot).length : 0;
        const preview = (msg?.content || "").slice(0, 120);
        return (
          <div
            className="fixed inset-0 z-[200] flex items-center justify-center animate-fade-in"
            style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)" }}
            onClick={() => !reverting && setRevertTarget(null)}
          >
            <div
              className="w-[460px] max-w-[92vw] px-7 py-7 animate-scale-in"
              style={{ background: "#0a0a0a", border: "1px solid rgba(245,245,245,0.12)" }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-2 mb-4">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#ffffff" }} />
                <span className="font-mono text-[10px] uppercase tracking-[0.32em]" style={{ color: "rgba(245,245,245,0.5)", fontWeight: 600 }}>
                  Confirm revert
                </span>
              </div>
              <h2
                className="font-serif mb-3"
                style={{ color: "#ffffff", fontWeight: 700, fontSize: 26, lineHeight: 1, letterSpacing: "-0.02em" }}
              >
                Revert to this checkpoint?
              </h2>
              <p className="font-serif italic mb-4" style={{ color: "rgba(245,245,245,0.6)", fontSize: 13.5, lineHeight: 1.5 }}>
                All {fileCount} cached file{fileCount === 1 ? "" : "s"} will be rewritten to the state they were in
                when you sent this message. AI changes after this point will be overwritten.
              </p>
              {preview && (
                <div
                  className="font-serif italic text-[12px] leading-[1.45] mb-5 pl-3"
                  style={{ color: "rgba(245,245,245,0.55)", borderLeft: "2px solid rgba(255,255,255,0.4)" }}
                >
                  {preview}{(msg?.content || "").length > 120 ? "…" : ""}
                </div>
              )}
              <div className="flex items-center gap-2 justify-end">
                <button
                  onClick={() => setRevertTarget(null)}
                  disabled={reverting}
                  className="font-mono uppercase tracking-[0.18em] px-3.5 h-8 disabled:opacity-30"
                  style={{ color: "rgba(245,245,245,0.6)", border: "1px solid rgba(245,245,245,0.12)", fontSize: 10.5, fontWeight: 600 }}
                >
                  Cancel
                </button>
                <button
                  onClick={doRevert}
                  disabled={reverting}
                  className="font-mono uppercase tracking-[0.18em] px-3.5 h-8 disabled:opacity-50 inline-flex items-center gap-1.5"
                  style={{ background: "#ffffff", color: "#0a0a0a", fontSize: 10.5, fontWeight: 700 }}
                >
                  {reverting ? <Loader2 size={11} className="animate-spin-custom" /> : <span>↶</span>}
                  {reverting ? "Reverting" : "Revert files"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ── Log entry: grid (time | content), used for both user + assistant ───────

function LogEntry({ msg, isLast, aiIsLoading, showThinking, ts, canRevert, onRevert }: {
  msg: ChatMessage;
  isLast: boolean;
  aiIsLoading: boolean;
  showThinking: boolean;
  ts?: number;
  canRevert?: boolean;
  onRevert?: () => void;
}) {
  const tools = msg.toolCalls ?? [];
  // Prefer the ordered segment timeline. Fall back to the legacy flat layout
  // (tools-then-text) for messages persisted before segments existed.
  const segments: MessageSegment[] = msg.segments
    ?? (
      tools.length || msg.content
        ? [
            ...tools.map((tool): MessageSegment => ({ type: "tool", tool })),
            ...(msg.content ? [{ type: "text" as const, text: msg.content }] : []),
          ]
        : []
    );

  return (
    <div
      className="px-3 py-2 grid gap-2.5 items-start"
      style={{
        gridTemplateColumns: "44px minmax(0,1fr)",
        borderBottom: "1px dashed rgba(245,245,245,0.05)",
      }}
    >
      <span className="font-mono text-[9px] tabular-nums pt-1" style={{ color: "rgba(245,245,245,0.35)", letterSpacing: "0.05em" }}>
        {formatTs(ts) || formatTs(Date.now())}
      </span>

      <div className="min-w-0 overflow-hidden group/msg">
        {msg.role === "user" ? (
          <div className="relative">
            <p
              className="font-serif italic m-0 whitespace-pre-wrap break-words"
              style={{
                fontSize: 14,
                lineHeight: 1.4,
                color: "#ffffff",
                borderLeft: "2px solid #ffffff",
                paddingLeft: 10,
                paddingRight: canRevert || msg.reverted ? 64 : 0,
              }}
            >
              {msg.content}
            </p>
            {msg.reverted ? (
              <span
                className="absolute right-0 top-0 font-mono text-[9px] uppercase tracking-[0.22em] px-1.5 py-0.5"
                style={{ color: "rgba(245,245,245,0.55)", border: "1px solid rgba(245,245,245,0.12)" }}
                title="Files were reverted to the state of this message"
              >
                reverted
              </span>
            ) : canRevert && onRevert ? (
              <button
                onClick={onRevert}
                className="absolute right-0 top-0 font-mono text-[9px] uppercase tracking-[0.22em] px-1.5 py-0.5 opacity-0 group-hover/msg:opacity-100 transition-opacity hover:opacity-100"
                style={{ color: "rgba(245,245,245,0.7)", border: "1px solid rgba(245,245,245,0.15)" }}
                title="Revert files to the state when this message was sent"
              >
                ↶ revert
              </button>
            ) : null}
          </div>
        ) : (
          <>
            {msg.thinking && !msg.isPermissionRetry && <ThinkingBlock thinking={msg.thinking} isLive={isLast && aiIsLoading} />}

            {segments.length > 0 ? (
              <div className="space-y-1.5">
                {segments.map((seg, i) => {
                  if (seg.type === "tool") {
                    const lastToolIdx = (() => {
                      for (let j = segments.length - 1; j >= 0; j--) {
                        if (segments[j].type === "tool") return j;
                      }
                      return -1;
                    })();
                    const isRunning = isLast && aiIsLoading && i === lastToolIdx;
                    return <ToolChip key={i} tool={seg.tool} running={isRunning} />;
                  }
                  return (
                    <div
                      key={i}
                      className="font-serif break-words"
                      style={{
                        fontWeight: 400,
                        fontSize: 13,
                        lineHeight: 1.5,
                        color: "#ffffff",
                        wordBreak: "break-word",
                        overflowWrap: "anywhere",
                      }}
                    >
                      <MessageText content={seg.text} />
                    </div>
                  );
                })}
              </div>
            ) : isLast && aiIsLoading ? (
              // Only show the dots while the run is actually streaming. Without
              // this guard, a finished-but-empty assistant message left the
              // dots on screen forever, looking like the AI was hung.
              <span className="typing-dots inline-flex items-end h-3" style={{ color: "rgba(245,245,245,0.4)" }}>
                <span /><span /><span />
              </span>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

// ── User questions card ────────────────────────────────────────────────────

function UserQuestionsCard({
  questions, onAnswer,
}: {
  questions: UserQuestion[];
  onAnswer: (answers: Record<string, string[]>) => void;
}) {
  const [picks, setPicks] = useState<Record<string, string[]>>({});
  const [submitted, setSubmitted] = useState(false);
  const allAnswered = questions.every((q) => (picks[q.question]?.length ?? 0) > 0);

  function toggle(q: UserQuestion, label: string) {
    if (submitted) return;
    setPicks((curr) => {
      const existing = curr[q.question] ?? [];
      if (q.multiSelect) {
        return { ...curr, [q.question]: existing.includes(label) ? existing.filter((x) => x !== label) : [...existing, label] };
      }
      return { ...curr, [q.question]: [label] };
    });
  }

  function submit() {
    if (!allAnswered || submitted) return;
    setSubmitted(true);
    onAnswer(picks);
  }

  return (
    <div className="space-y-2.5">
      {questions.map((q, qi) => (
        <div key={qi} className="border p-3" style={{ background: "rgba(255,255,255,0.02)", borderColor: "rgba(245,245,245,0.08)" }}>
          {q.header && (
            <div className="font-mono text-[9px] uppercase tracking-[0.22em] mb-1.5" style={{ color: "rgba(245,245,245,0.5)" }}>
              {q.header}
            </div>
          )}
          <div className="font-serif text-[13px] mb-2.5" style={{ color: "#ffffff", lineHeight: 1.4 }}>{q.question}</div>
          <div className="flex flex-col gap-1.5">
            {q.options.map((opt, oi) => {
              const selected = (picks[q.question] ?? []).includes(opt.label);
              return (
                <button
                  key={oi}
                  disabled={submitted}
                  onClick={() => toggle(q, opt.label)}
                  className="text-left px-2.5 py-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{
                    background: selected ? "rgba(255,255,255,0.08)" : "transparent",
                    borderLeft: selected ? "2px solid #ffffff" : "2px solid rgba(245,245,245,0.08)",
                  }}
                >
                  <div className="font-serif text-[12px]" style={{ color: selected ? "#ffffff" : "rgba(245,245,245,0.72)" }}>{opt.label}</div>
                  {opt.description && (
                    <div className="font-serif italic text-[10.5px] mt-0.5" style={{ color: "rgba(245,245,245,0.4)" }}>{opt.description}</div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <div className="flex justify-end">
        <button
          onClick={submit}
          disabled={!allAnswered || submitted}
          className="font-mono text-[9px] uppercase tracking-[0.22em] px-3 py-1.5 disabled:opacity-30 disabled:cursor-not-allowed"
          style={{ background: "#ffffff", color: "#0a0a0a", fontWeight: 600 }}
        >
          Submit
        </button>
      </div>
    </div>
  );
}

// ── Mode selector ──────────────────────────────────────────────────────────

function ModeSelector({ chatMode, setChatMode }: { chatMode: ChatMode; setChatMode: (m: ChatMode) => void }) {
  const [open, setOpen] = useState(false);
  const current = MODES.find((m) => m.value === chatMode)!;
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="font-mono text-[9px] uppercase tracking-[0.22em] inline-flex items-center gap-1"
        style={{ color: "rgba(245,245,245,0.5)" }}
      >
        {current.label.toLowerCase()}
        <ChevronDown size={7} />
      </button>
      {open && (
        <div
          className="absolute bottom-full left-0 mb-1.5 min-w-[160px] border shadow-card z-50 animate-scale-in origin-bottom-left overflow-hidden"
          style={{ background: "#0a0a0a", borderColor: "rgba(245,245,245,0.12)" }}
        >
          {MODES.map((m) => (
            <button
              key={m.value}
              onMouseDown={(e) => { e.preventDefault(); setChatMode(m.value); setOpen(false); }}
              className="w-full flex flex-col items-start px-3 py-2 text-left"
              style={{ background: m.value === chatMode ? "rgba(255,255,255,0.07)" : "transparent" }}
            >
              <span
                className="font-mono text-[10px] uppercase tracking-[0.22em]"
                style={{ color: m.value === chatMode ? "#ffffff" : "rgba(245,245,245,0.72)", fontWeight: 600 }}
              >
                {m.label}
              </span>
              <span className="font-serif italic text-[10px] mt-0.5" style={{ color: "rgba(245,245,245,0.4)" }}>{m.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
