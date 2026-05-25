"use client";

import { useIDEStore } from "@/store/useIDEStore";
import { useEffect, useRef, useState, useCallback } from "react";
import { Plus, X, Trash2, LayoutGrid, Terminal as TermIcon, RefreshCw, Columns, Rows, Pencil, Check, Lock, Unlock } from "lucide-react";

interface MultiTermSession {
  id: string;
  term: any;
  fitAddon: any;
  ws: WebSocket | null;
  container: HTMLDivElement;
  project: string;
  tmuxName: string;
  reconnectAttempts: number;
  heartbeatTimer?: ReturnType<typeof setInterval>;
}

interface TmuxSession {
  name: string;
  attached: boolean;
  windows: number;
}

// Module-level persistent state (survives component unmount/remount)
let globalSessions: Map<string, MultiTermSession> = new Map();
let globalPanels: { id: string; project: string; num: number; label: string; locked?: boolean }[] = [];
let globalXtermMod: any = null;
let globalFitMod: any = null;
let globalInited = false;
let globalCounter = 0;

const GRID_TERM_HEIGHT = 600;

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

export default function TerminalsContent() {
  const { availableProjects, currentView } = useIDEStore();

  const [panels, setPanels] = useState<{ id: string; project: string; num: number; label: string; locked?: boolean }[]>(globalPanels);
  const [layoutMode, setLayoutMode] = useState<"default" | "grid">("default");
  const [editingPanel, setEditingPanel] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [tmuxSessions, setTmuxSessions] = useState<TmuxSession[]>([]);
  const [showSessions, setShowSessions] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [killingSession, setKillingSession] = useState<string | null>(null);
  const [killingAll, setKillingAll] = useState(false);
  const [confirmKillAll, setConfirmKillAll] = useState(false);
  const [renamingSession, setRenamingSession] = useState<string | null>(null);
  const [renameSessionValue, setRenameSessionValue] = useState("");
  const [killModal, setKillModal] = useState<{ action: () => void; label: string } | null>(null);
  const [lockedSessions, setLockedSessions] = useState<Set<string>>(new Set());

  // Default mode: row height split (fraction for top row, 0.5 = equal)
  const [rowSplit, setRowSplit] = useState(0.5);
  // Default mode: column widths per row (fractions that sum to ~1)
  const [colWidthsTop, setColWidthsTop] = useState<number[]>([]);
  const [colWidthsBottom, setColWidthsBottom] = useState<number[]>([]);

  // Grid mode: number of columns
  const [gridCols, setGridCols] = useState(2);

  // Drag refs
  const dragRef = useRef<{
    type: "row" | "col-top" | "col-bottom" | "grid-col";
    index: number;
    startX: number;
    startY: number;
    containerRect: DOMRect;
    startWidths: number[];
    startSplit: number;
  } | null>(null);

  useEffect(() => { globalPanels = panels; }, [panels]);

  // Load xterm once
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

  // Fetch projects on mount
  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((d) => useIDEStore.getState().setAvailableProjects(d.projects || []))
      .catch(() => {});
  }, []);

  // Refit all terminals
  const refitAll = useCallback(() => {
    globalSessions.forEach((s) => {
      try {
        s.fitAddon?.fit();
        if (s.ws && s.ws.readyState === WebSocket.OPEN) {
          s.ws.send(JSON.stringify({ type: "resize", cols: s.term.cols, rows: s.term.rows }));
        }
      } catch {}
    });
  }, []);

  useEffect(() => {
    window.addEventListener("resize", refitAll);
    return () => window.removeEventListener("resize", refitAll);
  }, [refitAll]);

  useEffect(() => {
    const t = setTimeout(refitAll, 150);
    return () => clearTimeout(t);
  }, [panels.length, currentView, layoutMode, rowSplit, colWidthsTop, colWidthsBottom, gridCols, refitAll]);

  // On unmount: detach containers but keep sessions alive
  useEffect(() => {
    return () => {
      globalSessions.forEach((s) => {
        if (s.container.parentNode) s.container.parentNode.removeChild(s.container);
      });
    };
  }, []);

  // ── Drag resize handlers ───────────────────────────────────────────
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      e.preventDefault();

      if (d.type === "row") {
        const dy = e.clientY - d.startY;
        const totalH = d.containerRect.height;
        const newSplit = Math.max(0.2, Math.min(0.8, d.startSplit + dy / totalH));
        setRowSplit(newSplit);
      } else if (d.type === "col-top" || d.type === "col-bottom") {
        const dx = e.clientX - d.startX;
        const totalW = d.containerRect.width;
        const frac = dx / totalW;
        const ws = [...d.startWidths];
        const i = d.index;
        const minW = 0.15;
        ws[i] = Math.max(minW, ws[i] + frac);
        ws[i + 1] = Math.max(minW, ws[i + 1] - frac);
        const setter = d.type === "col-top" ? setColWidthsTop : setColWidthsBottom;
        setter(ws);
      }
    };
    const onMouseUp = () => { dragRef.current = null; document.body.style.cursor = ""; refitAll(); };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => { document.removeEventListener("mousemove", onMouseMove); document.removeEventListener("mouseup", onMouseUp); };
  }, [refitAll]);

  // ── Panel CRUD ─────────────────────────────────────────────────────

  function addPanel(overrideTmuxSession?: string) {
    if (layoutMode === "default" && panels.length >= 6) return;
    const id = `mt_${Date.now()}`;
    const project = availableProjects[0] || "_default";
    globalCounter++;
    const num = globalCounter;
    const projectLabel = project === "_default" ? "default" : project;
    const label = overrideTmuxSession || `${projectLabel}_${num}`;
    const newPanel = { id, project, num, label, _tmuxOverride: overrideTmuxSession } as any;
    globalPanels = [...globalPanels, newPanel];
    setPanels((prev) => [...prev, newPanel]);
  }

  function closePanel(id: string, force = false) {
    const panel = globalPanels.find((p) => p.id === id);
    if (!force && panel?.locked) return;
    const session = globalSessions.get(id);
    if (session) {
      session.ws?.close();
      try { session.term.dispose(); } catch {}
      session.container.remove();
      globalSessions.delete(id);
    }
    globalPanels = globalPanels.filter((p) => p.id !== id);
    setPanels((prev) => prev.filter((p) => p.id !== id));
  }

  function removePanel(id: string, force = false) {
    const panel = globalPanels.find((p) => p.id === id);
    if (!force && panel?.locked) return;
    const session = globalSessions.get(id);
    if (session && session.tmuxName) {
      fetch("/api/terminal/sessions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: session.tmuxName }),
      }).catch(() => {});
    }
    closePanel(id, true);
  }

  function togglePanelLock(id: string) {
    globalPanels = globalPanels.map((p) => p.id === id ? { ...p, locked: !p.locked } : p);
    setPanels((prev) => prev.map((p) => p.id === id ? { ...p, locked: !p.locked } : p));
  }

  async function renamePanel(id: string, newLabel: string) {
    const trimmed = newLabel.trim().replace(/[^a-zA-Z0-9_-]/g, "_");
    if (!trimmed) { setEditingPanel(null); return; }
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
    globalPanels = globalPanels.map((p) => (p.id === id ? { ...p, label: trimmed } : p));
    setPanels((prev) => prev.map((p) => (p.id === id ? { ...p, label: trimmed } : p)));
    setEditingPanel(null);
  }

  function changePanelProject(id: string, project: string) {
    setPanels((prev) => prev.map((p) => (p.id === id ? { ...p, project } : p)));
    const session = globalSessions.get(id);
    if (session) {
      // Null out session.ws first so the onclose handler sees a stale ws and skips auto-reconnect
      const oldWs = session.ws;
      session.ws = null;
      oldWs?.close();
      session.project = project;
      setTimeout(() => connectSession(session, project), 300);
    }
  }

  // ── Sessions management ────────────────────────────────────────────

  const fetchSessions = useCallback(async () => {
    setLoadingSessions(true);
    try {
      const res = await fetch("/api/terminal/sessions");
      const data = await res.json();
      setTmuxSessions(data.sessions || []);
      setShowSessions(true);
    } catch { setTmuxSessions([]); } finally { setLoadingSessions(false); }
  }, []);

  function attachToSession(sessionName: string) {
    setShowSessions(false);
    addPanel(sessionName);
    // Refresh sessions list after a short delay
    setTimeout(fetchSessions, 1000);
  }

  function toggleSessionLock(name: string) {
    setLockedSessions((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  }

  async function killSession(tmuxName: string) {
    if (lockedSessions.has(tmuxName)) return;
    setKillingSession(tmuxName);
    try {
      await fetch("/api/terminal/sessions", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: tmuxName }) });
      setTmuxSessions((prev) => prev.filter((s) => s.name !== tmuxName));
      // Close any open panels attached to this session
      const toRemove = [...globalSessions.entries()].filter(([, s]) => s.tmuxName === tmuxName).map(([id]) => id);
      for (const id of toRemove) removePanel(id, true);
    } catch {} finally { setKillingSession(null); }
  }

  async function killAllSessions() {
    setKillingAll(true);
    try {
      // Merge panel locks and session locks
      const lockedTmuxNames = new Set([
        ...lockedSessions,
        ...globalPanels.filter((p) => p.locked).map((p) => globalSessions.get(p.id)?.tmuxName).filter(Boolean) as string[],
      ]);
      for (const s of [...tmuxSessions]) {
        if (lockedTmuxNames.has(s.name)) continue;
        await fetch("/api/terminal/sessions", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: s.name }) });
      }
      setTmuxSessions((prev) => prev.filter((s) => lockedTmuxNames.has(s.name)));
      // Close all unlocked panels
      const allIds = [...globalSessions.keys()];
      for (const id of allIds) {
        const p = globalPanels.find((p) => p.id === id);
        if (!p?.locked) removePanel(id, true);
      }
    } catch {} finally { setKillingAll(false); }
  }

  async function renameSession(oldName: string, newName: string) {
    const trimmed = newName.trim().replace(/[^a-zA-Z0-9_-]/g, "_");
    if (!trimmed || trimmed === oldName) { setRenamingSession(null); return; }
    try {
      await fetch("/api/terminal/sessions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oldName, newName: trimmed }),
      });
      setTmuxSessions((prev) => prev.map((s) => s.name === oldName ? { ...s, name: trimmed } : s));
      // Update any open panels that reference this tmux session
      globalSessions.forEach((session) => {
        if (session.tmuxName === oldName) session.tmuxName = trimmed;
      });
      globalPanels = globalPanels.map((p) => p.label === oldName ? { ...p, label: trimmed } : p);
      setPanels((prev) => prev.map((p) => p.label === oldName ? { ...p, label: trimmed } : p));
    } catch {}
    setRenamingSession(null);
  }

  // ── Terminal mount & connect ───────────────────────────────────────

  function mountTerminal(id: string, wrapperEl: HTMLDivElement | null) {
    if (!wrapperEl) return;
    const existing = globalSessions.get(id);
    if (existing) {
      if (existing.container.parentNode !== wrapperEl) wrapperEl.appendChild(existing.container);
      setTimeout(() => {
        try {
          existing.fitAddon?.fit();
          if (existing.ws && existing.ws.readyState === WebSocket.OPEN)
            existing.ws.send(JSON.stringify({ type: "resize", cols: existing.term.cols, rows: existing.term.rows }));
        } catch {}
      }, 50);
      return;
    }
    if (!globalInited) return;
    const Terminal = globalXtermMod;
    const FitAddon = globalFitMod;
    if (!Terminal || !FitAddon) return;

    const container = document.createElement("div");
    container.style.width = "100%";
    container.style.height = "100%";
    container.style.overflow = "hidden";
    wrapperEl.appendChild(container);

    const term = new Terminal({
      fontFamily: "Consolas, 'Cascadia Mono', 'JetBrains Mono', 'Courier New', monospace",
      fontSize: 13, cursorBlink: true, cursorStyle: "block" as const, scrollback: 50000,
      theme: {
        background: "#0a0a0a", foreground: "#d1d5db", cursor: "#d1d5db",
        selectionBackground: "rgba(59,130,246,0.35)",
        black: "#1e1e1e", red: "#f87171", green: "#4ade80", yellow: "#facc15",
        blue: "#60a5fa", magenta: "#c084fc", cyan: "#22d3ee", white: "#d1d5db",
        brightBlack: "#6b7280", brightRed: "#fca5a5", brightGreen: "#86efac", brightYellow: "#fde047",
        brightBlue: "#93c5fd", brightMagenta: "#d8b4fe", brightCyan: "#67e8f9", brightWhite: "#f9fafb",
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);
    setTimeout(() => { try { fitAddon.fit(); } catch {} }, 100);

    const panel = globalPanels.find((p) => p.id === id);
    const project = panel?.project || "_default";
    const tmuxOverride = (panel as any)?._tmuxOverride;

    const session: MultiTermSession = { id, term, fitAddon, ws: null, container, project, tmuxName: "", reconnectAttempts: 0 };
    globalSessions.set(id, session);

    term.onSelectionChange(() => { const sel = term.getSelection(); if (sel) copyToClipboard(sel); });

    // Paste: intercept browser paste event (works on HTTP)
    let pasteHandled = false;
    const pasteHandler = (e: Event) => {
      if (pasteHandled) return;
      const ce = e as ClipboardEvent;
      const text = ce.clipboardData?.getData("text");
      if (text && session.ws && session.ws.readyState === WebSocket.OPEN) {
        ce.preventDefault(); ce.stopPropagation();
        pasteHandled = true;
        session.ws.send(text);
        setTimeout(() => { pasteHandled = false; }, 100);
      }
    };
    container.addEventListener("paste", pasteHandler, true);

    term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      if (e.type !== "keydown") return true;
      if (e.ctrlKey && e.shiftKey && (e.key === "C" || e.code === "KeyC")) {
        e.preventDefault(); e.stopPropagation();
        const sel = term.getSelection(); if (sel) copyToClipboard(sel); return false;
      }
      // Ctrl+Shift+V or Ctrl+V — let browser handle it so native paste event fires
      if (e.ctrlKey && (e.key === "v" || e.key === "V" || e.code === "KeyV")) { return false; }
      return true;
    });

    container.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      document.getElementById("sofi-term-ctx")?.remove();
      const menu = document.createElement("div");
      menu.id = "sofi-term-ctx";
      menu.style.cssText = `position:fixed;top:${e.clientY}px;left:${e.clientX}px;z-index:9999;background:#121212;border:1px solid #444444;border-radius:0;padding:4px 0;min-width:120px;box-shadow:0 4px 12px rgba(0,0,0,.5);`;
      const mkItem = (label: string, action: () => void) => {
        const div = document.createElement("div");
        div.textContent = label;
        div.style.cssText = "padding:6px 14px;color:#E0E0E0;font-size:13px;cursor:pointer;font-family:'Publica Sans',system-ui,sans-serif;";
        div.onmouseenter = () => (div.style.background = "rgba(68,68,68,0.55)");
        div.onmouseleave = () => (div.style.background = "transparent");
        div.onclick = () => { action(); menu.remove(); };
        return div;
      };
      menu.appendChild(mkItem("Copy", () => { const sel = term.getSelection(); if (sel) copyToClipboard(sel); }));
      menu.appendChild(mkItem("Paste", () => {
        const xt = container.querySelector("textarea.xterm-helper-textarea") as HTMLTextAreaElement;
        if (xt) { xt.focus(); document.execCommand("paste"); setTimeout(() => term.focus(), 100); }
      }));
      document.body.appendChild(menu);
      const dismiss = (ev: MouseEvent) => { if (!menu.contains(ev.target as Node)) { menu.remove(); document.removeEventListener("click", dismiss); } };
      setTimeout(() => document.addEventListener("click", dismiss), 0);
    });

    term.onData((data: string) => { if (session.ws && session.ws.readyState === WebSocket.OPEN) session.ws.send(data); });
    term.onResize(({ cols, rows }: { cols: number; rows: number }) => {
      if (session.ws && session.ws.readyState === WebSocket.OPEN) session.ws.send(JSON.stringify({ type: "resize", cols, rows }));
    });

    connectSession(session, project, tmuxOverride);
  }

  function connectSession(session: MultiTermSession, project: string, overrideTmuxSession?: string) {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const safeProject = project === "_default" ? "" : project;
    const panel = globalPanels.find((p) => p.id === session.id);
    // On reconnect (no override), reuse existing tmuxName to reattach to same session
    const tmuxName = overrideTmuxSession || session.tmuxName || panel?.label || (safeProject ? `${safeProject}_${panel?.num || 1}` : `default_${panel?.num || 1}`);
    session.tmuxName = tmuxName;

    const cols = session.term.cols || 80;
    const rows = session.term.rows || 24;
    const url = `${proto}://${window.location.host}/ws/terminal?project=${encodeURIComponent(safeProject)}&cols=${cols}&rows=${rows}&session=${encodeURIComponent(tmuxName)}`;
    const ws = new WebSocket(url);
    session.ws = ws;
    ws.onopen = () => {
      session.reconnectAttempts = 0;
      ws.send(JSON.stringify({ type: "resize", cols: session.term.cols, rows: session.term.rows }));

      if (session.heartbeatTimer) clearInterval(session.heartbeatTimer);
      session.heartbeatTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "heartbeat" }));
        }
      }, 15000);
    };
    ws.onmessage = (e) => { if (typeof e.data === "string") session.term.write(e.data); else session.term.write(new Uint8Array(e.data)); };
    ws.onclose = () => {
      // Ignore stale handlers from previous connections
      if (session.ws !== ws) return;
      if (session.heartbeatTimer) { clearInterval(session.heartbeatTimer); session.heartbeatTimer = undefined; }
      if (globalSessions.has(session.id)) {
        // Unexpected disconnect — auto-reconnect with exponential backoff
        session.reconnectAttempts++;
        const delay = Math.min(1500 * Math.pow(2, session.reconnectAttempts - 1), 30000);
        session.term.write(`\r\n\x1b[33m[Disconnected — reconnecting in ${Math.round(delay / 1000)}s...]\x1b[0m\r\n`);
        setTimeout(() => {
          if (globalSessions.has(session.id)) connectSession(session, session.project);
        }, delay);
      }
    };
    ws.onerror = () => {};
  }

  // ── Panel header component ─────────────────────────────────────────

  function renderPanelHeader(panel: typeof panels[0]) {
    return (
      <div className="flex items-center h-8 min-h-[32px] px-2 border-b border-ide-border gap-2 shrink-0">
        {editingPanel === panel.id ? (
          <input autoFocus value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={() => renamePanel(panel.id, editValue)}
            onKeyDown={(e) => { if (e.key === "Enter") renamePanel(panel.id, editValue); if (e.key === "Escape") setEditingPanel(null); }}
            className="h-6 px-1 text-xs text-ide-text bg-ide-hover border border-ide-border outline-none max-w-[120px]"
          />
        ) : (
          <span onDoubleClick={() => { setEditingPanel(panel.id); setEditValue(panel.label); }}
            className="text-xs text-ide-text truncate max-w-[120px] cursor-default"
            title={`${panel.label} — double-click to rename`}>{panel.label}</span>
        )}
        <select value={panel.project} onChange={(e) => changePanelProject(panel.id, e.target.value)}
          className="h-6 px-1 text-xs text-ide-text bg-ide-hover border border-ide-border outline-none max-w-[120px] truncate">
          {availableProjects.map((p) => (<option key={p} value={p}>{p}</option>))}
          <option value="_default">Default</option>
        </select>
        <div className="flex-1" />
        <button
          onClick={() => togglePanelLock(panel.id)}
          className={`p-1 transition-colors ${panel.locked ? "text-yellow-400 hover:text-yellow-300" : "text-ide-muted hover:text-ide-text"}`}
          title={panel.locked ? "Unlock terminal" : "Lock terminal"}
        >
          {panel.locked ? <Lock size={11} /> : <Unlock size={11} />}
        </button>
        <button onClick={() => !panel.locked && setKillModal({ action: () => removePanel(panel.id), label: panel.label })} disabled={panel.locked} className={`p-1 transition-colors ${panel.locked ? "text-ide-muted opacity-30 cursor-not-allowed" : "text-ide-muted hover:text-ide-text"}`} title={panel.locked ? "Unlock to kill" : "Kill terminal"}><Trash2 size={11} /></button>
        <button onClick={() => !panel.locked && closePanel(panel.id)} disabled={panel.locked} className={`p-1 transition-colors ${panel.locked ? "text-ide-muted opacity-30 cursor-not-allowed" : "text-ide-muted hover:text-red-400"}`} title={panel.locked ? "Unlock to close" : "Close terminal"}><X size={11} /></button>
      </div>
    );
  }

  // ── Default layout helpers ─────────────────────────────────────────

  function getDefaultRows() {
    if (panels.length <= 3) return [panels, []] as const;
    const mid = Math.ceil(panels.length / 2);
    return [panels.slice(0, mid), panels.slice(mid)] as const;
  }

  function ensureColWidths(count: number, current: number[]) {
    if (current.length === count) return current;
    return Array(count).fill(1 / count);
  }

  function startColDrag(e: React.MouseEvent, type: "col-top" | "col-bottom", index: number, containerEl: HTMLElement, widths: number[]) {
    e.preventDefault();
    document.body.style.cursor = "col-resize";
    dragRef.current = { type, index, startX: e.clientX, startY: e.clientY, containerRect: containerEl.getBoundingClientRect(), startWidths: [...widths], startSplit: rowSplit };
  }

  function startRowDrag(e: React.MouseEvent, containerEl: HTMLElement) {
    e.preventDefault();
    document.body.style.cursor = "row-resize";
    dragRef.current = { type: "row", index: 0, startX: e.clientX, startY: e.clientY, containerRect: containerEl.getBoundingClientRect(), startWidths: [], startSplit: rowSplit };
  }

  // ── Render ─────────────────────────────────────────────────────────

  const maxReached = layoutMode === "default" && panels.length >= 6;
  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center h-10 min-h-[40px] px-3 border-b border-ide-border gap-2 shrink-0">
        <LayoutGrid size={16} className="text-ide-text" />
        <span className="text-sm font-semibold text-ide-text">Multi-Terminal</span>
        {layoutMode === "default" && <span className="text-xs text-ide-muted">({panels.length}/6)</span>}
        {layoutMode === "grid" && <span className="text-xs text-ide-muted">({panels.length})</span>}

        <div className="flex-1" />

        {/* Layout mode toggle */}
        <div className="flex items-center border border-ide-border">
          <button
            onClick={() => setLayoutMode("default")}
            className={`flex items-center gap-1 px-2 h-7 text-xs transition-colors ${layoutMode === "default" ? "bg-ide-active text-ide-text" : "text-ide-muted hover:text-ide-text hover:bg-ide-hover"}`}
            title="Default — max 6, resizable"
          >
            <Columns size={12} />
            Default
          </button>
          <button
            onClick={() => setLayoutMode("grid")}
            className={`flex items-center gap-1 px-2 h-7 text-xs transition-colors ${layoutMode === "grid" ? "bg-ide-active text-ide-text" : "text-ide-muted hover:text-ide-text hover:bg-ide-hover"}`}
            title="Grid — unlimited, scrollable"
          >
            <Rows size={12} />
            Grid
          </button>
        </div>

        {layoutMode === "grid" && (
          <select
            value={gridCols}
            onChange={(e) => setGridCols(parseInt(e.target.value))}
            className="h-7 px-1 text-xs text-ide-text bg-ide-hover border border-ide-border outline-none"
            title="Columns"
          >
            <option value={1}>1 col</option>
            <option value={2}>2 cols</option>
            <option value={3}>3 cols</option>
            <option value={4}>4 cols</option>
          </select>
        )}

        <button onClick={fetchSessions}
          className={`flex items-center gap-1 px-3 h-7 text-xs text-blue-400 bg-blue-400/10 border border-blue-400/20 hover:bg-blue-400/20 transition-colors ${loadingSessions ? "animate-pulse" : ""}`}>
          <TermIcon size={12} /> Sessions
        </button>
        <button onClick={() => addPanel()} disabled={maxReached}
          className="flex items-center gap-1 px-3 h-7 text-xs text-ide-text bg-ide-hover border border-ide-border hover:bg-[rgba(85,85,85,0.7)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
          <Plus size={12} /> New Terminal
        </button>
      </div>

      {/* Sessions dropdown */}
      {showSessions && (
        <div className="border-b border-ide-border bg-[#111] px-3 py-2 shrink-0">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-ide-text">Active Terminal Sessions</span>
            <div className="flex items-center gap-2">
              {tmuxSessions.length > 1 && (
                <button onClick={() => setKillModal({ action: killAllSessions, label: "all sessions" })} disabled={killingSession !== null || killingAll}
                  className={`px-1.5 py-0.5 text-[10px] flex items-center gap-1 transition-colors disabled:cursor-not-allowed ${killingAll ? "bg-red-500/20 text-red-400 opacity-60" : "bg-red-500/20 text-red-400 hover:bg-red-500/30"} disabled:opacity-30`}>
                  {killingAll && (<svg className="animate-spin h-2.5 w-2.5" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>)}
                  {killingAll ? "Killing all..." : "Kill All"}
                </button>
              )}
              <button onClick={fetchSessions} className="text-ide-muted hover:text-ide-text" title="Refresh"><RefreshCw size={11} /></button>
              <button onClick={() => { setShowSessions(false); setConfirmKillAll(false); }} className="text-ide-muted hover:text-ide-text"><X size={11} /></button>
            </div>
          </div>
          {tmuxSessions.length === 0 ? (
            <p className="text-xs text-ide-muted py-1">No active terminal sessions</p>
          ) : (
            <div className="flex flex-wrap gap-2 max-h-24 overflow-y-auto">
              {tmuxSessions.map((s) => {
                const isKilling = killingSession === s.name;
                const isBlocked = killingSession !== null || killingAll;
                const isRenaming = renamingSession === s.name;
                const isSessionLocked = lockedSessions.has(s.name);
                return (
                  <div key={s.name} className={`flex items-center gap-2 bg-[#1a1a1a] border px-2 py-1 ${isKilling ? "border-red-500/30 opacity-60" : isSessionLocked ? "border-yellow-500/30" : "border-ide-border"}`}>
                    <span className={`${isKilling ? "text-red-400 animate-pulse" : s.attached ? "text-yellow-400" : "text-green-400"}`}><TermIcon size={10} /></span>
                    {isRenaming ? (
                      <div className="flex items-center gap-1">
                        <input
                          autoFocus
                          value={renameSessionValue}
                          onChange={(e) => setRenameSessionValue(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") renameSession(s.name, renameSessionValue); if (e.key === "Escape") setRenamingSession(null); }}
                          className="h-5 w-24 px-1 text-xs text-ide-text bg-ide-hover border border-ide-border outline-none"
                        />
                        <button onClick={() => renameSession(s.name, renameSessionValue)} className="p-0.5 text-green-400 hover:text-green-300"><Check size={10} /></button>
                        <button onClick={() => setRenamingSession(null)} className="p-0.5 text-ide-muted hover:text-ide-text"><X size={10} /></button>
                      </div>
                    ) : (
                      <span className={`text-xs ${isKilling ? "text-red-400 line-through" : "text-ide-text"}`} title={s.name}>
                        {s.name}{s.attached && <span className="ml-1 text-yellow-400/70 text-[10px]">(attached)</span>}{s.windows > 1 && <span className="ml-1 text-ide-muted text-[10px]">({s.windows}w)</span>}
                      </span>
                    )}
                    <button
                      onClick={() => toggleSessionLock(s.name)}
                      className={`p-0.5 transition-colors ${isSessionLocked ? "text-yellow-400 hover:text-yellow-300" : "text-ide-muted hover:text-ide-text"}`}
                      title={isSessionLocked ? "Unlock session" : "Lock session"}
                    >
                      {isSessionLocked ? <Lock size={10} /> : <Unlock size={10} />}
                    </button>
                    {!isRenaming && (
                      <button onClick={() => { setRenamingSession(s.name); setRenameSessionValue(s.name); }} disabled={isBlocked} className="px-1.5 py-0.5 text-[10px] bg-ide-hover text-ide-muted hover:text-ide-text disabled:opacity-30 disabled:cursor-not-allowed" title="Rename session"><Pencil size={10} /></button>
                    )}
                    <button onClick={() => attachToSession(s.name)} disabled={isBlocked} className="px-1.5 py-0.5 text-[10px] bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 disabled:opacity-30 disabled:cursor-not-allowed">Attach</button>
                    <button onClick={() => !isSessionLocked && setKillModal({ action: () => killSession(s.name), label: s.name })} disabled={isBlocked || isSessionLocked} className={`px-1.5 py-0.5 text-[10px] flex items-center gap-1 transition-colors ${isSessionLocked ? "bg-red-500/10 text-red-400/30 cursor-not-allowed" : "bg-red-500/20 text-red-400 hover:bg-red-500/30 disabled:opacity-30 disabled:cursor-not-allowed"}`} title={isSessionLocked ? "Unlock to kill" : undefined}>
                      {isKilling && (<svg className="animate-spin h-2.5 w-2.5" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>)}
                      {isKilling ? "Killing..." : "Kill"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <style>{`
        .xterm-viewport { scrollbar-width: auto; scrollbar-color: rgba(100, 100, 100, 0.7) #0e0e0e; }
        .xterm-viewport::-webkit-scrollbar { width: 10px; }
        .xterm-viewport::-webkit-scrollbar-track { background: #0e0e0e; }
        .xterm-viewport::-webkit-scrollbar-thumb { background: rgba(100, 100, 100, 0.7); border: 2px solid #0e0e0e; }
        .xterm-viewport::-webkit-scrollbar-thumb:hover { background: rgba(140, 140, 140, 0.85); }
      `}</style>

      {/* Empty state */}
      {panels.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-ide-muted">
          <LayoutGrid size={48} className="opacity-30" />
          <p className="text-sm">No terminals open</p>
          <button onClick={() => addPanel()}
            className="flex items-center gap-2 px-4 h-9 text-sm text-ide-text bg-ide-hover border border-ide-border hover:bg-[rgba(85,85,85,0.7)] transition-colors">
            <Plus size={14} /> Add first terminal
          </button>
        </div>
      ) : layoutMode === "default" ? (
        /* ── DEFAULT LAYOUT: max 6, resizable rows & columns ─────────── */
        (() => {
          const [topRow, bottomRow] = getDefaultRows();
          const hasBottom = bottomRow.length > 0;
          const topWidths = ensureColWidths(topRow.length, colWidthsTop);
          const bottomWidths = ensureColWidths(bottomRow.length, colWidthsBottom);

          // Sync state if lengths changed
          if (topWidths !== colWidthsTop) setTimeout(() => setColWidthsTop(topWidths), 0);
          if (bottomWidths !== colWidthsBottom) setTimeout(() => setColWidthsBottom(bottomWidths), 0);

          return (
            <div ref={containerRef} className="flex-1 min-h-0 flex flex-col overflow-hidden">
              {/* Top row */}
              <div className="flex overflow-hidden" style={{ height: hasBottom ? `${rowSplit * 100}%` : "100%", minHeight: 80 }}>
                {topRow.map((panel, i) => (
                  <div key={panel.id} className="flex" style={{ width: `${topWidths[i] * 100}%`, minWidth: 120 }}>
                    <div className="flex-1 flex flex-col bg-[#0a0a0a] overflow-hidden min-w-0">
                      {renderPanelHeader(panel)}
                      <div className="flex-1 min-h-0 overflow-hidden" ref={(el) => { if (el) mountTerminal(panel.id, el); }} />
                    </div>
                    {/* Column resize handle */}
                    {i < topRow.length - 1 && (
                      <div className="w-[3px] bg-ide-border hover:bg-blue-500/50 cursor-col-resize shrink-0 transition-colors"
                        onMouseDown={(e) => containerRef.current && startColDrag(e, "col-top", i, containerRef.current, topWidths)} />
                    )}
                  </div>
                ))}
              </div>

              {/* Row resize handle */}
              {hasBottom && (
                <div className="h-[3px] bg-ide-border hover:bg-blue-500/50 cursor-row-resize shrink-0 transition-colors"
                  onMouseDown={(e) => containerRef.current && startRowDrag(e, containerRef.current)} />
              )}

              {/* Bottom row */}
              {hasBottom && (
                <div className="flex overflow-hidden" style={{ height: `${(1 - rowSplit) * 100}%`, minHeight: 80 }}>
                  {bottomRow.map((panel, i) => (
                    <div key={panel.id} className="flex" style={{ width: `${bottomWidths[i] * 100}%`, minWidth: 120 }}>
                      <div className="flex-1 flex flex-col bg-[#0a0a0a] overflow-hidden min-w-0">
                        {renderPanelHeader(panel)}
                        <div className="flex-1 min-h-0 overflow-hidden" ref={(el) => { if (el) mountTerminal(panel.id, el); }} />
                      </div>
                      {i < bottomRow.length - 1 && (
                        <div className="w-[3px] bg-ide-border hover:bg-blue-500/50 cursor-col-resize shrink-0 transition-colors"
                          onMouseDown={(e) => containerRef.current && startColDrag(e, "col-bottom", i, containerRef.current, bottomWidths)} />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })()
      ) : (
        /* ── GRID LAYOUT: unlimited, fixed height, scrollable ────────── */
        <div className="flex-1 overflow-y-auto">
          <div className="flex flex-wrap" style={{ minHeight: "100%" }}>
            {panels.map((panel) => (
              <div key={panel.id} className="flex flex-col bg-[#0a0a0a] border-b border-r border-ide-border overflow-hidden"
                style={{ width: `${100 / gridCols}%`, height: GRID_TERM_HEIGHT, minWidth: gridCols === 1 ? "100%" : 200 }}>
                {renderPanelHeader(panel)}
                <div className="flex-1 min-h-0 overflow-hidden" ref={(el) => { if (el) mountTerminal(panel.id, el); }} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Kill confirmation modal */}
      {killModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60">
          <div className="bg-ide-surface border border-ide-border w-[340px] shadow-[0_8px_32px_rgba(0,0,0,.6)]">
            <div className="flex items-center justify-between px-4 py-3 border-b border-ide-border">
              <span className="text-sm font-semibold text-ide-text">Kill Terminal</span>
              <button onClick={() => setKillModal(null)} className="text-ide-muted hover:text-ide-text">
                <X size={14} />
              </button>
            </div>
            <div className="px-4 py-4 flex flex-col gap-4">
              <p className="text-[13px] text-ide-muted">
                Are you sure you want to kill{" "}
                <span className="text-ide-text font-semibold">{killModal.label}</span>?
                The terminal session will be destroyed.
              </p>
              <div className="flex items-center gap-2 justify-end">
                <button
                  onClick={() => setKillModal(null)}
                  className="px-3 h-8 text-sm text-ide-text bg-ide-hover border border-ide-border hover:bg-[rgba(85,85,85,0.7)] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => { killModal.action(); setKillModal(null); }}
                  className="px-3 h-8 text-sm text-white bg-red-600/80 border border-red-500/50 hover:bg-red-600 transition-colors"
                >
                  Kill
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
