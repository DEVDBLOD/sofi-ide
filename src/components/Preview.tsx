"use client";

import { useState } from "react";
import { useIDEStore } from "@/store/useIDEStore";
import {
  Monitor, Tablet, Smartphone,
  ZoomIn, ZoomOut,
  ExternalLink, Plus, X, RefreshCw,
} from "lucide-react";

const VPS_IP = "191.101.71.217";

interface PreviewPanel {
  id: string;
  url: string;
  mode: "vps" | "custom";
  port: string;
}

let panelCounter = 0;

function buildVpsUrl(port: string) {
  return `http://${VPS_IP}:${port || "3000"}`;
}

export default function Preview() {
  const { device, zoom, setDevice, setZoom } = useIDEStore();
  const [reloadKey, setReloadKey] = useState<Record<string, number>>({});

  const [panels, setPanels] = useState<PreviewPanel[]>(() => {
    panelCounter++;
    return [{ id: `prev_${panelCounter}`, url: buildVpsUrl("3000"), mode: "vps", port: "3000" }];
  });

  function addPanel() {
    panelCounter++;
    setPanels((prev) => [
      ...prev,
      { id: `prev_${panelCounter}`, url: buildVpsUrl("3000"), mode: "vps", port: "3000" },
    ]);
  }

  function removePanel(id: string) {
    setPanels((prev) => prev.length <= 1 ? prev : prev.filter((p) => p.id !== id));
  }

  function updatePanel(id: string, updates: Partial<PreviewPanel>) {
    setPanels((prev) => prev.map((p) => (p.id === id ? { ...p, ...updates } : p)));
  }

  function toggleMode(id: string) {
    setPanels((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        if (p.mode === "vps") return { ...p, mode: "custom" as const, url: "" };
        const port = p.port || "3000";
        return { ...p, mode: "vps" as const, url: buildVpsUrl(port) };
      })
    );
  }

  function updatePort(id: string, port: string) {
    setPanels((prev) =>
      prev.map((p) => p.id === id ? { ...p, port, url: buildVpsUrl(port) } : p)
    );
  }

  const widthMap = { desktop: "100%", tablet: "900px", mobile: "420px" };
  const previewWidth = widthMap[device];

  return (
    <div className="flex-1 h-full flex flex-col overflow-hidden border-r" style={{ background: "#0a0a0a", borderColor: "rgba(245,245,245,0.06)" }}>
      {/* ── Global toolbar ──────────────────────────────────────────── */}
      <div className="flex items-center px-4 h-10 border-b shrink-0 gap-4" style={{ borderColor: "rgba(245,245,245,0.06)" }}>
        <span className="font-mono text-[10px] uppercase tracking-[0.32em] shrink-0" style={{ color: "rgba(245,245,245,0.4)", fontWeight: 600 }}>
          Preview
        </span>

        {/* Device toggle — mono caps */}
        <div className="flex items-center gap-4">
          {(["desktop", "tablet", "mobile"] as const).map((d) => {
            const Icon = d === "desktop" ? Monitor : d === "tablet" ? Tablet : Smartphone;
            const active = device === d;
            return (
              <button
                key={d}
                onClick={() => setDevice(d)}
                className="flex items-center gap-1.5 h-7 font-mono uppercase tracking-[0.22em] transition-colors"
                style={{ color: active ? "#ffffff" : "rgba(245,245,245,0.4)", fontSize: 10, fontWeight: active ? 700 : 500 }}
                title={d}
              >
                <Icon size={11} strokeWidth={1.6} />
                {d}
              </button>
            );
          })}
        </div>

        <div className="flex-1" />

        {/* Zoom */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setZoom(zoom - 10)}
            className="w-6 h-6 flex items-center justify-center transition-colors hover:bg-ide-hover"
            style={{ color: "rgba(245,245,245,0.5)" }}
            title="Zoom out"
          >
            <ZoomOut size={11} />
          </button>
          <span className="font-mono text-[10px] tabular-nums tracking-[0.12em] min-w-[34px] text-center" style={{ color: "#ffffff", fontWeight: 600 }}>
            {zoom}%
          </span>
          <button
            onClick={() => setZoom(zoom + 10)}
            className="w-6 h-6 flex items-center justify-center transition-colors hover:bg-ide-hover"
            style={{ color: "rgba(245,245,245,0.5)" }}
            title="Zoom in"
          >
            <ZoomIn size={11} />
          </button>
        </div>

        <span className="h-4 w-px shrink-0" style={{ background: "rgba(245,245,245,0.1)" }} />

        {/* Add panel */}
        <button
          onClick={addPanel}
          className="flex items-center gap-1.5 h-7 px-2.5 font-mono uppercase tracking-[0.18em] transition-colors hover:bg-ide-hover"
          style={{ color: "rgba(255,255,255,0.85)", fontSize: 10, fontWeight: 600, border: "1px solid rgba(245,245,245,0.1)" }}
        >
          <Plus size={11} />
          Add
        </button>
      </div>

      {/* ── Stacked preview panels ─────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {panels.map((panel, idx) => (
          <div
            key={panel.id}
            className={`flex flex-col ${idx > 0 ? "border-t" : ""}`}
            style={{ minHeight: panels.length === 1 ? "100%" : "50vh", borderColor: "rgba(245,245,245,0.06)" }}
          >
            {/* Panel header */}
            <div className="flex items-center h-10 px-4 border-b gap-3 shrink-0" style={{ borderColor: "rgba(245,245,245,0.06)", background: "rgba(255,255,255,0.02)" }}>
              {/* Numbered eyebrow */}
              <span className="font-mono text-[10px] tabular-nums" style={{ color: "rgba(245,245,245,0.4)" }}>
                {String(idx + 1).padStart(2, "0")}
              </span>

              {/* Mode toggle */}
              <button
                onClick={() => toggleMode(panel.id)}
                className="font-mono uppercase tracking-[0.18em] px-2 py-1 transition-colors shrink-0"
                style={{
                  color: "#ffffff",
                  border: "1px solid rgba(255,255,255,0.25)",
                  fontSize: 9.5,
                  fontWeight: 600,
                }}
                title={panel.mode === "vps" ? "Switch to custom URL" : "Switch to VPS"}
              >
                {panel.mode === "vps" ? "vps" : "custom"}
              </button>

              {/* URL section */}
              {panel.mode === "vps" ? (
                <div className="flex items-baseline gap-1 shrink-0 font-mono" style={{ fontSize: 12 }}>
                  <span style={{ color: "rgba(245,245,245,0.5)" }}>{VPS_IP}</span>
                  <span style={{ color: "rgba(245,245,245,0.3)" }}>:</span>
                  <input
                    value={panel.port}
                    onChange={(e) => updatePort(panel.id, e.target.value.replace(/[^0-9]/g, ""))}
                    placeholder="3000"
                    maxLength={5}
                    className="w-14 bg-transparent outline-none transition-colors pb-0.5"
                    style={{ color: "#ffffff", fontSize: 12, borderBottom: "1px solid rgba(245,245,245,0.15)" }}
                  />
                </div>
              ) : (
                <input
                  value={panel.url}
                  onChange={(e) => updatePanel(panel.id, { url: e.target.value })}
                  placeholder="https://example.com"
                  className="flex-1 max-w-[420px] bg-transparent font-mono outline-none transition-colors pb-0.5"
                  style={{ color: "#ffffff", fontSize: 12, borderBottom: "1px solid rgba(245,245,245,0.15)" }}
                />
              )}

              {/* Reload */}
              <button
                onClick={() => setReloadKey((prev) => ({ ...prev, [panel.id]: (prev[panel.id] || 0) + 1 }))}
                className="btn-icon"
                title="Reload"
              >
                <RefreshCw size={11} />
              </button>

              {/* External */}
              <button
                onClick={() => window.open(panel.url, "_blank")}
                className="btn-icon"
                title="Open in browser"
              >
                <ExternalLink size={11} />
              </button>

              <div className="flex-1" />

              {panels.length > 1 && (
                <button
                  onClick={() => removePanel(panel.id)}
                  className="btn-icon"
                  title="Remove preview"
                  style={{ color: "rgba(245,245,245,0.4)" }}
                >
                  <X size={11} />
                </button>
              )}
            </div>

            {/* Iframe */}
            <div className="flex-1 flex items-start justify-center p-4 overflow-auto" style={{ background: "#050505" }}>
              <div
                style={{
                  width: previewWidth,
                  height: panels.length === 1 ? "calc(100vh - 220px)" : "calc(50vh - 80px)",
                  transform: `scale(${zoom / 100})`,
                  transformOrigin: "top center",
                  transition: "all 0.3s ease",
                  border: "1px solid rgba(245,245,245,0.08)",
                  background: "#0a0a0a",
                }}
                className="overflow-hidden"
              >
                <iframe
                  key={`${panel.id}-${reloadKey[panel.id] || 0}`}
                  src={panel.url}
                  style={{ width: "100%", height: "100%", border: "none", background: "#0a0a0a" }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
