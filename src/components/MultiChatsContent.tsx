"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Plus, X, MessageSquare } from "lucide-react";
import { useIDEStore } from "@/store/useIDEStore";
import ChatPanel from "@/components/ChatPanel";

interface ChatPanelEntry {
  id: string;
  project: string;
}

const STORAGE_KEY = "sofi_chat_panels";

// Module-level state survives view switches (same as TerminalsContent)
let globalPanels: ChatPanelEntry[] = [];
let globalColWidths: number[] = [];
let globalCounter = 0;

function makeId() {
  globalCounter += 1;
  return `cp-${globalCounter}`;
}

function addPanel(project: string): ChatPanelEntry {
  const entry: ChatPanelEntry = { id: makeId(), project };
  globalPanels = [...globalPanels, entry];
  const n = globalPanels.length;
  globalColWidths = Array(n).fill(1 / n);
  return entry;
}

function savePanels(panels: ChatPanelEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(panels.map((p) => p.project)));
  } catch {}
}

function loadSavedPanels(): string[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return null;
    return arr as string[];
  } catch {
    return null;
  }
}

export default function MultiChatsContent() {
  const { availableProjects } = useIDEStore();
  const [panels, setPanels] = useState<ChatPanelEntry[]>(() => {
    if (globalPanels.length === 0) {
      const saved = loadSavedPanels();
      if (saved && saved.length > 0) {
        saved.forEach((p) => addPanel(p));
      } else {
        addPanel("");
      }
    }
    return globalPanels;
  });
  const [colWidths, setColWidths] = useState<number[]>(() =>
    globalColWidths.length > 0 ? globalColWidths : [1]
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    index: number;
    startX: number;
    startWidths: number[];
    containerW: number;
  } | null>(null);

  // Sync to module state and persist panel projects to localStorage
  useEffect(() => { globalPanels = panels; savePanels(panels); }, [panels]);
  useEffect(() => { globalColWidths = colWidths; }, [colWidths]);

  // Fetch projects list once
  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((d) => useIDEStore.getState().setAvailableProjects(d.projects || []))
      .catch(() => {});
  }, []);

  const addNewPanel = useCallback(() => {
    const entry = addPanel("");
    setPanels([...globalPanels]);
    setColWidths([...globalColWidths]);
  }, []);

  const removePanel = useCallback((id: string) => {
    if (globalPanels.length <= 1) return;
    globalPanels = globalPanels.filter((p) => p.id !== id);
    const n = globalPanels.length;
    globalColWidths = Array(n).fill(1 / n);
    setPanels([...globalPanels]);
    setColWidths([...globalColWidths]);
  }, []);

  const setProject = useCallback((id: string, project: string) => {
    globalPanels = globalPanels.map((p) => p.id === id ? { ...p, project } : p);
    setPanels([...globalPanels]);
    if (project) useIDEStore.getState().ensureConvForProject(project);
  }, []);

  // Column resize drag
  const onDragStart = useCallback((e: React.MouseEvent, index: number) => {
    e.preventDefault();
    if (!containerRef.current) return;
    dragRef.current = {
      index,
      startX: e.clientX,
      startWidths: [...colWidths],
      containerW: containerRef.current.getBoundingClientRect().width,
    };

    const onMove = (ev: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const delta = (ev.clientX - d.startX) / d.containerW;
      const next = [...d.startWidths];
      next[d.index] = Math.max(0.15, d.startWidths[d.index] + delta);
      next[d.index + 1] = Math.max(0.15, d.startWidths[d.index + 1] - delta);
      const sum = next.reduce((a, b) => a + b, 0);
      setColWidths(next.map((w) => w / sum));
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [colWidths]);

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden" style={{ background: "#0a0a0a" }}>
      {/* Toolbar */}
      <div
        className="flex items-center gap-3 px-4 shrink-0 border-b"
        style={{ height: 36, borderColor: "rgba(245,245,245,0.06)" }}
      >
        <MessageSquare size={12} style={{ color: "rgba(245,245,245,0.4)" }} />
        <span
          className="font-mono text-[9.5px] uppercase tracking-[0.28em]"
          style={{ color: "rgba(245,245,245,0.4)" }}
        >
          Multi-Chat
        </span>
        <button
          onClick={addNewPanel}
          className="flex items-center gap-1.5 h-5 px-2 font-mono text-[9px] uppercase tracking-[0.2em] transition-colors"
          style={{
            color: "rgba(245,245,245,0.5)",
            border: "1px solid rgba(245,245,245,0.12)",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "#ffffff")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(245,245,245,0.5)")}
          title="Add chat panel"
        >
          <Plus size={9} />
          Add panel
        </button>
      </div>

      {/* Panels */}
      <div ref={containerRef} className="flex flex-1 min-h-0 overflow-hidden">
        {panels.map((panel, i) => (
          <div key={panel.id} className="flex min-h-0" style={{ width: `${colWidths[i] * 100}%`, flexShrink: 0 }}>
            {/* Drag handle between panels */}
            {i > 0 && (
              <div
                onMouseDown={(e) => onDragStart(e, i - 1)}
                className="w-1 shrink-0 cursor-col-resize transition-colors hover:bg-white/10"
                style={{ background: "rgba(245,245,245,0.06)" }}
              />
            )}

            <div className="flex flex-col flex-1 min-h-0 min-w-0 overflow-hidden" style={{ borderRight: i < panels.length - 1 ? "none" : undefined }}>
              {/* Panel header */}
              <PanelHeader
                panel={panel}
                availableProjects={availableProjects}
                canClose={panels.length > 1}
                onClose={() => removePanel(panel.id)}
                onProjectChange={(p) => setProject(panel.id, p)}
              />

              {/* Chat */}
              <div className="flex flex-1 min-h-0 overflow-hidden">
                {panel.project ? (
                  <ChatPanel panelProjectName={panel.project} />
                ) : (
                  <NoProjectPlaceholder onSelect={(p) => setProject(panel.id, p)} projects={availableProjects} />
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PanelHeader({
  panel,
  availableProjects,
  canClose,
  onClose,
  onProjectChange,
}: {
  panel: ChatPanelEntry;
  availableProjects: string[];
  canClose: boolean;
  onClose: () => void;
  onProjectChange: (p: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className="flex items-center gap-2 px-3 shrink-0 relative"
      style={{
        height: 32,
        background: "#0d0d0d",
        borderBottom: "1px solid rgba(245,245,245,0.06)",
      }}
    >
      {/* Project selector */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 font-mono text-[9.5px] uppercase tracking-[0.22em] transition-colors"
        style={{ color: panel.project ? "#ffffff" : "rgba(245,245,245,0.35)" }}
      >
        {panel.project || "select project"}
        <span style={{ color: "rgba(245,245,245,0.4)", fontSize: 8 }}>▾</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="absolute top-full left-0 mt-1 z-50 min-w-[180px] max-h-60 overflow-auto"
            style={{
              background: "#141414",
              border: "1px solid rgba(245,245,245,0.12)",
            }}
          >
            {availableProjects.length === 0 && (
              <div className="px-3 py-2 font-mono text-[10px]" style={{ color: "rgba(245,245,245,0.4)" }}>
                No projects
              </div>
            )}
            {availableProjects.map((p) => (
              <button
                key={p}
                onClick={() => { onProjectChange(p); setOpen(false); }}
                className="w-full text-left px-3 py-1.5 font-mono text-[10.5px] transition-colors"
                style={{
                  color: p === panel.project ? "#ffffff" : "rgba(245,245,245,0.7)",
                  background: p === panel.project ? "rgba(255,255,255,0.06)" : "transparent",
                }}
                onMouseEnter={(e) => { if (p !== panel.project) e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
                onMouseLeave={(e) => { if (p !== panel.project) e.currentTarget.style.background = "transparent"; }}
              >
                {p}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="flex-1" />

      {canClose && (
        <button
          onClick={onClose}
          className="flex items-center justify-center w-4 h-4 transition-colors"
          style={{ color: "rgba(245,245,245,0.3)" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "#ffffff")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(245,245,245,0.3)")}
          title="Close panel"
        >
          <X size={10} />
        </button>
      )}
    </div>
  );
}

function NoProjectPlaceholder({ onSelect, projects }: { onSelect: (p: string) => void; projects: string[] }) {
  return (
    <div className="flex flex-col items-center justify-center flex-1 gap-3" style={{ color: "rgba(245,245,245,0.4)" }}>
      <MessageSquare size={24} style={{ opacity: 0.3 }} />
      <span className="font-mono text-[10px] uppercase tracking-[0.2em]">Select a project</span>
      <div className="flex flex-col gap-1 mt-1">
        {projects.map((p) => (
          <button
            key={p}
            onClick={() => onSelect(p)}
            className="px-3 py-1 font-mono text-[11px] transition-colors"
            style={{ color: "rgba(245,245,245,0.6)", border: "1px solid rgba(245,245,245,0.1)" }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "#ffffff"; e.currentTarget.style.borderColor = "rgba(245,245,245,0.3)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "rgba(245,245,245,0.6)"; e.currentTarget.style.borderColor = "rgba(245,245,245,0.1)"; }}
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}
