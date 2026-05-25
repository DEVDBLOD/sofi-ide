"use client";

import { useIDEStore } from "@/store/useIDEStore";
import { Terminal as TermIcon, Trash2, Plus, X, Maximize2, Minimize2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface TermSession {
  term: any;
  fitAddon: any;
  ws: WebSocket | null;
  container: HTMLDivElement;
  label: string;
  tmuxName: string;
  keepaliveTimer: ReturnType<typeof setInterval> | null;
  reconnectAttempts: number;
}

// ── Module-level persistent state (survives component unmount/remount) ──
let globalTabCounter = 0;
let globalSessions: Map<string, TermSession> = new Map();
let globalTabs: { id: string; label: string }[] = [];
let globalActiveTab = "";
let globalXtermMod: any = null;
let globalFitMod: any = null;
let globalInited = false;

export default function TerminalPanel({ width, onToggleCode }: { width?: number; onToggleCode?: () => void }) {
  const { projectName, currentView } = useIDEStore();

  const wrapperRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(false);

  const [tabs, setTabs] = useState<{ id: string; label: string }[]>(globalTabs);
  const [activeTab, setActiveTab] = useState<string>(globalActiveTab);
  const [editingTab, setEditingTab] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [killConfirm, setKillConfirm] = useState<{ id: string; label: string; type: "kill" | "close" } | null>(null);

  // Keep globals in sync with React state
  useEffect(() => { globalTabs = tabs; }, [tabs]);
  useEffect(() => { globalActiveTab = activeTab; }, [activeTab]);

  // ── Load xterm modules once (globally) ────────────────────────────────
  useEffect(() => {
    if (globalInited) return;
    (async () => {
      const { Terminal } = await import("xterm");
      const { FitAddon } = await import("xterm-addon-fit");
      await import("xterm/css/xterm.css");
      globalXtermMod = Terminal;
      globalFitMod = FitAddon;
      globalInited = true;
    })();
  }, []);

  // ── On mount: reattach existing sessions or create first tab ──────────
  useEffect(() => {
    mountedRef.current = true;

    const tryInit = () => {
      if (!wrapperRef.current) return;

      // Reattach existing session containers to the new wrapper DOM node
      if (globalSessions.size > 0) {
        globalSessions.forEach((session, key) => {
          wrapperRef.current!.appendChild(session.container);
          session.container.style.display = key === globalActiveTab ? "block" : "none";
        });
        // Re-fit the active terminal
        const active = globalSessions.get(globalActiveTab);
        if (active) {
          setTimeout(() => {
            try {
              active.fitAddon?.fit();
              if (active.ws && active.ws.readyState === WebSocket.OPEN) {
                active.ws.send(JSON.stringify({ type: "resize", cols: active.term.cols, rows: active.term.rows }));
              }
            } catch {}
          }, 50);
        }
        return;
      }

      // No auto-create — user clicks "+" to open a terminal
    };

    if (globalInited) {
      tryInit();
    } else {
      const timer = setTimeout(tryInit, 400);
      return () => clearTimeout(timer);
    }
  }, []);

  // ── On unmount: detach containers from DOM but keep everything alive ──
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      globalSessions.forEach((session) => {
        if (session.container.parentNode) {
          session.container.parentNode.removeChild(session.container);
        }
      });
    };
  }, []);

  // ── Show/hide containers when active tab changes ──────────────────────
  useEffect(() => {
    globalSessions.forEach((s, k) => {
      s.container.style.display = k === activeTab ? "block" : "none";
    });
    const session = globalSessions.get(activeTab);
    if (session) {
      setTimeout(() => {
        try { session.fitAddon?.fit(); } catch {}
      }, 50);
    }
  }, [activeTab]);

  // ── Re-fit active terminal when panel resizes or view changes ─────────
  useEffect(() => {
    const session = globalSessions.get(activeTab);
    if (!session) return;
    const id = setTimeout(() => {
      try {
        session.fitAddon?.fit();
        if (session.ws && session.ws.readyState === WebSocket.OPEN) {
          session.ws.send(
            JSON.stringify({ type: "resize", cols: session.term.cols, rows: session.term.rows })
          );
        }
      } catch {}
    }, 50);
    return () => clearTimeout(id);
  }, [width, currentView]);

  // ── Window resize ─────────────────────────────────────────────────────
  useEffect(() => {
    const handleResize = () => {
      const session = globalSessions.get(activeTab);
      if (session) {
        try { session.fitAddon.fit(); } catch {}
      }
    };
    window.addEventListener("resize", handleResize);

    const handleRunOutput = (e: Event) => {
      const { filename, output } = (e as CustomEvent).detail;
      const out = (output || "[No output]").replace(/\n/g, "\r\n");
      const session = globalSessions.get(activeTab);
      if (session) {
        session.term.write(`\r\n\x1b[36m[Run] ${filename}\x1b[0m\r\n${out}\r\n`);
      }
    };
    window.addEventListener("sofi-run-output", handleRunOutput);

    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("sofi-run-output", handleRunOutput);
    };
  }, [activeTab]);

  // Clipboard helpers that work on HTTP (not just HTTPS)
  function copyToClipboard(text: string) {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).catch(() => {});
    } else {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;left:-9999px;top:-9999px;opacity:0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch {}
      ta.remove();
    }
  }

  function setupTerminalHandlers(term: any, session: TermSession, container: HTMLDivElement) {
    // Auto-copy on selection
    term.onSelectionChange(() => {
      const sel = term.getSelection();
      if (sel) copyToClipboard(sel);
    });

    // ── Paste: intercept browser paste event (works on HTTP, no clipboard API needed)
    let pasteHandled = false;
    const pasteHandler = (e: Event) => {
      if (pasteHandled) return; // Prevent double paste from event bubbling
      const ce = e as ClipboardEvent;
      const text = ce.clipboardData?.getData("text");
      if (text && session.ws && session.ws.readyState === WebSocket.OPEN) {
        ce.preventDefault();
        ce.stopPropagation();
        pasteHandled = true;
        session.ws.send(text);
        setTimeout(() => { pasteHandled = false; }, 100);
      }
    };
    container.addEventListener("paste", pasteHandler, true);

    term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      if (e.type !== "keydown") return true;
      // Ctrl+Shift+C — copy
      if (e.ctrlKey && e.shiftKey && (e.key === "C" || e.code === "KeyC")) {
        e.preventDefault();
        e.stopPropagation();
        const sel = term.getSelection();
        if (sel) copyToClipboard(sel);
        return false;
      }
      // Ctrl+Shift+V or Ctrl+V — let the browser handle it so native paste event fires
      if (e.ctrlKey && (e.key === "v" || e.key === "V" || e.code === "KeyV")) {
        return false; // Don't send to terminal, let browser fire paste event
      }
      return true;
    });

    container.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      document.getElementById("sofi-term-ctx")?.remove();
      const menu = document.createElement("div");
      menu.id = "sofi-term-ctx";
      menu.style.cssText = `position:fixed;top:${e.clientY}px;left:${e.clientX}px;z-index:9999;background:#121212;border:1px solid #444444;border-radius:0;padding:4px 0;min-width:120px;box-shadow:0 4px 12px rgba(0,0,0,.5);`;
      const mkItem = (label: string, action: () => void) => {
        const btn = document.createElement("div");
        btn.textContent = label;
        btn.style.cssText = "padding:6px 14px;color:#E0E0E0;font-size:13px;cursor:pointer;font-family:'Publica Sans',system-ui,sans-serif;";
        btn.onmouseenter = () => (btn.style.background = "rgba(68,68,68,0.55)");
        btn.onmouseleave = () => (btn.style.background = "transparent");
        btn.onclick = () => { action(); menu.remove(); };
        return btn;
      };
      menu.appendChild(mkItem("Copy", () => {
        const sel = term.getSelection();
        if (sel) copyToClipboard(sel);
      }));
      menu.appendChild(mkItem("Paste", () => {
        // Trigger a real paste via execCommand so the paste event fires
        const xt = container.querySelector("textarea.xterm-helper-textarea") as HTMLTextAreaElement;
        if (xt) { xt.focus(); document.execCommand("paste"); setTimeout(() => term.focus(), 100); }
      }));
      document.body.appendChild(menu);
      const dismiss = (ev: MouseEvent) => {
        if (!menu.contains(ev.target as Node)) { menu.remove(); document.removeEventListener("click", dismiss); }
      };
      setTimeout(() => document.addEventListener("click", dismiss), 0);
    });
  }

  function addTab() {
    if (!wrapperRef.current || !globalInited) return;

    const Terminal = globalXtermMod;
    const FitAddon = globalFitMod;
    if (!Terminal || !FitAddon) return;

    globalTabCounter++;
    const id = `tab_${Date.now()}_${globalTabCounter}`;
    const project = useIDEStore.getState().projectName || "default";
    const label = `${project}_${globalTabCounter}`;

    const container = document.createElement("div");
    container.style.width = "100%";
    container.style.height = "100%";
    container.style.overflow = "hidden";
    wrapperRef.current.appendChild(container);

    const term = new Terminal({
      fontFamily: "Consolas, 'Cascadia Mono', 'JetBrains Mono', 'Courier New', monospace",
      fontSize: 13,
      cursorBlink: true,
      cursorStyle: "block",
      scrollback: 50000,
      theme: {
        background: "#0a0a0a",
        foreground: "#d1d5db",
        cursor: "#d1d5db",
        selectionBackground: "rgba(59,130,246,0.35)",
        black: "#1e1e1e",
        red: "#f87171",
        green: "#4ade80",
        yellow: "#facc15",
        blue: "#60a5fa",
        magenta: "#c084fc",
        cyan: "#22d3ee",
        white: "#d1d5db",
        brightBlack: "#6b7280",
        brightRed: "#fca5a5",
        brightGreen: "#86efac",
        brightYellow: "#fde047",
        brightBlue: "#93c5fd",
        brightMagenta: "#d8b4fe",
        brightCyan: "#67e8f9",
        brightWhite: "#f9fafb",
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);

    setTimeout(() => {
      try { fitAddon.fit(); } catch {}
    }, 100);

    const session: TermSession = { term, fitAddon, ws: null, container, label, tmuxName: label, keepaliveTimer: null, reconnectAttempts: 0 };
    globalSessions.set(id, session);

    connectSession(id, session);
    setupTerminalHandlers(term, session, container);

    term.onData((data: string) => {
      if (session.ws && session.ws.readyState === WebSocket.OPEN) {
        session.ws.send(data);
      }
    });

    term.onResize(({ cols, rows }: { cols: number; rows: number }) => {
      if (session.ws && session.ws.readyState === WebSocket.OPEN) {
        session.ws.send(JSON.stringify({ type: "resize", cols, rows }));
      }
    });

    setTabs((prev) => [...prev, { id, label }]);
    setActiveTab(id);
  }

  function closeTab(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    const session = globalSessions.get(id);
    if (session) {
      if (session.keepaliveTimer) clearInterval(session.keepaliveTimer);
      session.ws?.close();
      try { session.term.dispose(); } catch {}
      session.container.remove();
      globalSessions.delete(id);
    }

    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (activeTab === id) {
        const newActive = next.length > 0 ? next[next.length - 1].id : "";
        setActiveTab(newActive);
      }
      return next;
    });
  }

  function connectSession(key: string, session: TermSession) {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const store = useIDEStore.getState();
    const project = store.projectName || "_default";
    const safeProject = project === "_default" ? "" : project;
    // On reconnect, reuse the existing tmuxName to reattach to the same session
    const tmuxName = session.tmuxName && session.tmuxName !== session.label
      ? session.tmuxName
      : (safeProject ? `${safeProject}_${session.label}` : `default_${session.label}`);
    session.tmuxName = tmuxName;

    const cols = session.term.cols || 80;
    const rows = session.term.rows || 24;
    const url = `${proto}://${window.location.host}/ws/terminal?project=${encodeURIComponent(safeProject)}&cols=${cols}&rows=${rows}&session=${encodeURIComponent(tmuxName)}`;

    const ws = new WebSocket(url);
    session.ws = ws;

    ws.onopen = () => {
      session.reconnectAttempts = 0;
      ws.send(JSON.stringify({ type: "resize", cols: session.term.cols, rows: session.term.rows }));

      if (session.keepaliveTimer) clearInterval(session.keepaliveTimer);
      session.keepaliveTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "keepalive" }));
        }
      }, 15000);
    };

    ws.onmessage = (e) => {
      if (typeof e.data === "string") {
        session.term.write(e.data);
      } else {
        session.term.write(new Uint8Array(e.data));
      }
    };

    ws.onclose = () => {
      // Ignore stale handlers from previous connections
      if (session.ws !== ws) return;
      if (session.keepaliveTimer) { clearInterval(session.keepaliveTimer); session.keepaliveTimer = null; }
      if (globalSessions.has(key)) {
        // Unexpected disconnect — auto-reconnect with exponential backoff
        session.reconnectAttempts++;
        const delay = Math.min(1500 * Math.pow(2, session.reconnectAttempts - 1), 30000);
        session.term.write(`\r\n\x1b[33m[Disconnected — reconnecting in ${Math.round(delay / 1000)}s...]\x1b[0m\r\n`);
        setTimeout(() => {
          if (globalSessions.has(key)) connectSession(key, session);
        }, delay);
      }
    };

    ws.onerror = () => {};
  }

  function requestKillTab() {
    if (!activeTab) return;
    const tab = tabs.find((t) => t.id === activeTab);
    setKillConfirm({ id: activeTab, label: tab?.label || "terminal", type: "kill" });
  }

  function requestCloseTab(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    const tab = tabs.find((t) => t.id === id);
    setKillConfirm({ id, label: tab?.label || "terminal", type: "close" });
  }

  function confirmKillAction() {
    if (!killConfirm) return;
    const { id, type } = killConfirm;
    setKillConfirm(null);

    const session = globalSessions.get(id);
    if (session) {
      if (type === "kill" && session.tmuxName) {
        fetch("/api/terminal/sessions", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: session.tmuxName }),
        }).catch(() => {});
      }
      if (session.keepaliveTimer) clearInterval(session.keepaliveTimer);
      session.ws?.close();
      try { session.term.dispose(); } catch {}
      session.container.remove();
      globalSessions.delete(id);
    }

    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (activeTab === id) {
        setActiveTab(next.length > 0 ? next[next.length - 1].id : "");
      }
      return next;
    });
  }

  async function renameTab(id: string, newLabel: string) {
    const trimmed = newLabel.trim().replace(/[^a-zA-Z0-9_-]/g, "_");
    if (!trimmed) { setEditingTab(null); return; }
    const session = globalSessions.get(id);
    if (session && session.tmuxName) {
      try {
        await fetch("/api/terminal/sessions", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ oldName: session.tmuxName, newName: trimmed }),
        });
        session.tmuxName = trimmed;
      } catch {}
    }
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, label: trimmed } : t)));
    if (session) session.label = trimmed;
    setEditingTab(null);
  }

  return (
    <div
      style={width ? { width, minWidth: 180 } : { flex: 1 }}
      className="h-full bg-[#0a0a0a] border-l border-ide-border flex flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center h-9 min-h-[36px] px-2 border-b border-ide-border shrink-0">
        <div className="flex items-center gap-2">
          <TermIcon size={16} className="text-ide-text" />
          <span className="text-sm font-semibold text-ide-text">Terminal</span>
        </div>
        <div className="flex-1" />

        {onToggleCode && (
          <button
            onClick={onToggleCode}
            title={width ? "Terminal only" : "Show code editor"}
            className="p-1 mr-1 text-ide-text hover:bg-ide-hover"
          >
            {width ? <Maximize2 size={13} /> : <Minimize2 size={13} />}
          </button>
        )}

        <button onClick={requestKillTab} className="p-1 text-ide-text hover:bg-ide-hover" title="Kill terminal">
          <Trash2 size={13} />
        </button>
      </div>

      {/* Tabs bar */}
      <div className="flex items-center h-7 min-h-[28px] border-b border-ide-border shrink-0 overflow-x-auto">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1 px-2 h-full cursor-pointer text-xs border-r border-ide-border ${
              activeTab === tab.id
                ? "bg-[#0a0a0a] text-ide-text"
                : "bg-ide-bg text-ide-muted hover:text-ide-text"
            }`}
          >
            <TermIcon size={10} />
            {editingTab === tab.id ? (
              <input
                autoFocus
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={() => renameTab(tab.id, editValue)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") renameTab(tab.id, editValue);
                  if (e.key === "Escape") setEditingTab(null);
                }}
                onClick={(e) => e.stopPropagation()}
                className="w-16 px-0.5 text-xs text-ide-text bg-ide-hover border border-ide-border outline-none"
              />
            ) : (
              <span
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setEditingTab(tab.id);
                  setEditValue(tab.label);
                }}
                title="Double-click to rename"
              >
                {tab.label}
              </span>
            )}
            {tabs.length > 1 && (
              <button
                onClick={(e) => closeTab(tab.id, e)}
                className="ml-1 hover:text-red-400"
              >
                <X size={10} />
              </button>
            )}
          </div>
        ))}
        <button
          onClick={() => addTab()}
          className="flex items-center justify-center w-6 h-full text-ide-muted hover:text-ide-text"
          title="New terminal"
        >
          <Plus size={12} />
        </button>
      </div>

      {/* Terminal sessions container */}
      <style>{`
        .xterm-viewport { scrollbar-width: auto; scrollbar-color: rgba(100, 100, 100, 0.7) #0e0e0e; }
        .xterm-viewport::-webkit-scrollbar { width: 10px; }
        .xterm-viewport::-webkit-scrollbar-track { background: #0e0e0e; }
        .xterm-viewport::-webkit-scrollbar-thumb { background: rgba(100, 100, 100, 0.7); border: 2px solid #0e0e0e; }
        .xterm-viewport::-webkit-scrollbar-thumb:hover { background: rgba(140, 140, 140, 0.85); }
      `}</style>
      <div ref={wrapperRef} className="flex-1 w-full min-h-0 overflow-hidden" />

      {/* Kill/close confirmation modal */}
      {killConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60">
          <div className="bg-ide-surface border border-ide-border w-[340px] shadow-[0_8px_32px_rgba(0,0,0,.6)]">
            <div className="flex items-center justify-between px-4 py-3 border-b border-ide-border">
              <span className="text-sm font-semibold text-ide-text">
                {killConfirm.type === "kill" ? "Kill Terminal" : "Close Terminal"}
              </span>
              <button onClick={() => setKillConfirm(null)} className="text-ide-muted hover:text-ide-text">
                <X size={14} />
              </button>
            </div>
            <div className="px-4 py-4 flex flex-col gap-4">
              <p className="text-[13px] text-ide-muted">
                {killConfirm.type === "kill"
                  ? <>Are you sure you want to kill <span className="text-ide-text font-semibold">{killConfirm.label}</span>? The terminal session will be destroyed.</>
                  : <>Are you sure you want to close <span className="text-ide-text font-semibold">{killConfirm.label}</span>? The terminal session will persist in the background.</>
                }
              </p>
              <div className="flex items-center gap-2 justify-end">
                <button
                  onClick={() => setKillConfirm(null)}
                  className="px-3 h-8 text-sm text-ide-text bg-ide-hover border border-ide-border hover:bg-[rgba(85,85,85,0.7)] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmKillAction}
                  className="px-3 h-8 text-sm text-white bg-red-600/80 border border-red-500/50 hover:bg-red-600 transition-colors"
                >
                  {killConfirm.type === "kill" ? "Kill" : "Close"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
