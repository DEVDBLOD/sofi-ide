"use client";

import { useIDEStore } from "@/store/useIDEStore";
import { getMonacoLanguage, isImageFile } from "@/lib/utils";
import { FileIcon } from "@/components/FileIcon";
import {
  FileCode2,
  X,
  Play,
  Loader2,
  CircleAlert,
  Circle,
  Check,
  XCircle,
  ChevronUp,
  ChevronDown,
  ChevronRight,
  CheckCheck,
  Undo2,
  Plus,
  Minus,
  AlertTriangle,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Image as ImageIcon,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { setupMonaco } from "@/lib/monacoSetup";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <div className="flex-1 flex items-center justify-center bg-ide-bg text-ide-muted">
      Loading editor...
    </div>
  ),
});

const MonacoDiffEditor = dynamic(
  () =>
    import("@monaco-editor/react").then((mod) => {
      const Comp = mod.DiffEditor || (mod as any).default?.DiffEditor;
      return { default: Comp };
    }),
  {
    ssr: false,
    loading: () => (
      <div className="flex-1 flex items-center justify-center bg-ide-bg text-ide-muted">
        Loading diff...
      </div>
    ),
  }
);

// ─── Myers diff ──────────────────────────────────────────────────────────────

function myersDiff(a: string[], b: string[]): Array<"eq" | "ins" | "del"> {
  const n = a.length, m = b.length;
  if (n === 0 && m === 0) return [];
  const max = n + m;
  const off = max;
  const v = new Array(2 * max + 2).fill(0);
  const trace: number[][] = [];

  for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      const ki = k + off;
      let x = (k === -d || (k !== d && v[ki - 1] < v[ki + 1]))
        ? v[ki + 1]
        : v[ki - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      v[ki] = x;
      if (x >= n && y >= m) return buildOps(trace, n, m, off);
    }
  }
  return [];
}

function buildOps(
  trace: number[][],
  n: number,
  m: number,
  off: number
): Array<"eq" | "ins" | "del"> {
  const ops: Array<"eq" | "ins" | "del"> = [];
  let x = n, y = m;
  for (let d = trace.length - 1; d > 0; d--) {
    const v = trace[d];
    const k = x - y;
    const ki = k + off;
    const prevK = (k === -d || (k !== d && v[ki - 1] < v[ki + 1])) ? k + 1 : k - 1;
    const prevX = v[prevK + off];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) { ops.push("eq"); x--; y--; }
    if (x === prevX) { ops.push("ins"); y--; }
    else             { ops.push("del"); x--; }
  }
  while (x > 0 && y > 0) { ops.push("eq"); x--; y--; }
  ops.reverse();
  return ops;
}

type Hunk = { fileId: string; modLine: number };

function computeHunks(orig: string, mod: string, fileId: string): Hunk[] {
  const a = orig === "" ? [] : orig.split("\n");
  const b = mod  === "" ? [] : mod.split("\n");
  if (a.length === 0 && b.length === 0) return [];

  // Fast path for large files
  if (a.length > 1500 || b.length > 1500) {
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
      if (a[i] !== b[i]) return [{ fileId, modLine: i + 1 }];
    }
    if (a.length !== b.length) return [{ fileId, modLine: len + 1 }];
    return [];
  }

  const ops = myersDiff(a, b);
  const hunks: Hunk[] = [];
  let inHunk = false;
  let modLine = 0;
  for (const op of ops) {
    if (op === "eq") { modLine++; inHunk = false; }
    else {
      if (!inHunk) { hunks.push({ fileId, modLine: Math.max(1, modLine + 1) }); inHunk = true; }
      if (op === "ins") modLine++;
    }
  }
  return hunks;
}

// ─── Image Viewer ─────────────────────────────────────────────────────────────

function ImageViewer({ fileName, dataUrl }: { fileName: string; dataUrl: string }) {
  const [zoom, setZoom] = useState(100);

  function adjustZoom(delta: number) {
    setZoom((z) => Math.max(10, Math.min(800, z + delta)));
  }

  const checkerboard = {
    backgroundImage: `linear-gradient(45deg, #222 25%, transparent 25%),
      linear-gradient(-45deg, #222 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, #222 75%),
      linear-gradient(-45deg, transparent 75%, #222 75%)`,
    backgroundSize: "16px 16px",
    backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0px",
    backgroundColor: "#1a1a1a",
  };

  const ready = dataUrl.startsWith("data:");

  return (
    <div className="flex-1 flex flex-col h-full bg-ide-bg overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-3 h-8 border-b border-ide-border bg-ide-panel shrink-0">
        <ImageIcon size={11} className="text-ide-muted mr-1" />
        <span className="text-[11px] text-ide-muted font-mono truncate max-w-[200px]">{fileName}</span>
        <div className="flex-1" />
        <button onClick={() => adjustZoom(-25)} disabled={!ready}
          className="w-6 h-6 flex items-center justify-center rounded text-ide-muted hover:text-ide-text hover:bg-ide-hover transition-colors disabled:opacity-40" title="Zoom out">
          <ZoomOut size={12} />
        </button>
        <span className="text-[11px] text-ide-muted font-mono tabular-nums min-w-[42px] text-center">{zoom}%</span>
        <button onClick={() => adjustZoom(25)} disabled={!ready}
          className="w-6 h-6 flex items-center justify-center rounded text-ide-muted hover:text-ide-text hover:bg-ide-hover transition-colors disabled:opacity-40" title="Zoom in">
          <ZoomIn size={12} />
        </button>
        <button onClick={() => setZoom(100)} disabled={!ready}
          className="w-6 h-6 flex items-center justify-center rounded text-ide-muted hover:text-ide-text hover:bg-ide-hover transition-colors ml-0.5 disabled:opacity-40" title="Reset zoom">
          <RotateCcw size={11} />
        </button>
      </div>

      {/* Image canvas */}
      <div className="flex-1 overflow-auto flex items-center justify-center p-8" style={checkerboard}>
        {!ready ? (
          <Loader2 size={20} className="animate-spin-custom text-ide-muted" />
        ) : (
          <img
            src={dataUrl}
            alt={fileName}
            style={{
              width: zoom !== 100 ? `${zoom}%` : undefined,
              maxWidth: zoom === 100 ? "100%" : undefined,
              maxHeight: zoom === 100 ? "100%" : undefined,
              imageRendering: zoom > 200 ? "pixelated" : "auto",
              objectFit: "contain",
              display: "block",
            }}
            className="shadow-2xl"
          />
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function CodeEditor() {
  const {
    activeFile,
    openFiles,
    fileTree,
    fileContents,
    openFile,
    closeFile,
    updateFileContent,
    markUserEdit,
    isRunning,
    setIsRunning,
    lintErrors,
    setLintErrors,
    projectName,
    pendingChanges,
    acceptChange,
    discardChange,
    acceptAllChanges,
    discardAllChanges,
    setFileDiagnostics,
    clearFileDiagnostics,
  } = useIDEStore();

  const saveTimerRef       = useRef<NodeJS.Timeout | null>(null);
  const lintTimerRef       = useRef<NodeJS.Timeout | null>(null);
  const diffEditorRef      = useRef<any>(null);
  const pendingRevealRef   = useRef<Hunk | null>(null);
  const monacoRef          = useRef<any>(null);
  const editorRef          = useRef<any>(null);
  const markerDisposable   = useRef<any>(null);
  const suppressSaveRef    = useRef(false);
  const projectNameRef     = useRef(projectName);
  const activeFileRef      = useRef(activeFile);
  useEffect(() => { projectNameRef.current = projectName; }, [projectName]);
  useEffect(() => { activeFileRef.current = activeFile; }, [activeFile]);

  const [currentHunkIdx, setCurrentHunkIdx] = useState(0);
  const [diagnostics, setDiagnostics] = useState({ errors: 0, warnings: 0 });

  type ProblemMarker = { line: number; col: number; message: string; severity: "error" | "warning" };
  const [problemMarkers, setProblemMarkers] = useState<ProblemMarker[]>([]);
  const [problemsOpen, setProblemsOpen] = useState(true);

  const hasPending      = activeFile in pendingChanges;
  const pendingFileIds  = Object.keys(pendingChanges);
  const pendingCount    = pendingFileIds.length;

  // Change type helpers for active file
  const isNewFile = hasPending && !(activeFile in fileContents);
  const isDeletedFile = hasPending && activeFile in fileContents && !(activeFile in fileTree);

  // ── All hunks across all pending files ──────────────────────────────────
  const pendingKey = pendingFileIds.join(",");
  const allHunks = useMemo(() => {
    const h: Hunk[] = [];
    for (const fid of pendingFileIds) {
      h.push(...computeHunks(fileContents[fid] ?? "", pendingChanges[fid] ?? "", fid));
    }
    return h;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingKey, pendingChanges, fileContents]);

  // Reset index when the set of pending files changes
  useEffect(() => { setCurrentHunkIdx(0); }, [pendingKey]);

  // Reset diagnostics when active file changes and re-lint
  useEffect(() => {
    setDiagnostics({ errors: 0, warnings: 0 });
    setProblemMarkers([]);
    if (monacoRef.current && editorRef.current) {
      const model = editorRef.current.getModel?.();
      if (model) monacoRef.current.editor.setModelMarkers(model, "sofi-lint", []);
    }
    clearFileDiagnostics(activeFile);
  }, [activeFile, clearFileDiagnostics]);

  function navigateTo(line: number, col: number) {
    if (!editorRef.current) return;
    editorRef.current.revealLineInCenter(line);
    editorRef.current.setPosition({ lineNumber: line, column: col });
    editorRef.current.focus();
  }

  const safeIdx = allHunks.length > 0 ? Math.min(currentHunkIdx, allHunks.length - 1) : 0;

  // ── Diff stats for active file ───────────────────────────────────────────
  const pendingStats = useMemo(() => {
    if (!hasPending) return { additions: 0, deletions: 0 };
    const original = (fileContents[activeFile] ?? "").trimEnd();
    const modified = (pendingChanges[activeFile] ?? "").trimEnd();
    const origLines = original === "" ? [] : original.split("\n");
    const modLines  = modified === "" ? [] : modified.split("\n");
    const origSet = new Map<string, number>();
    for (const l of origLines) origSet.set(l, (origSet.get(l) ?? 0) + 1);
    const modSet = new Map<string, number>();
    for (const l of modLines) modSet.set(l, (modSet.get(l) ?? 0) + 1);
    let deletions = 0;
    for (const [l, cnt] of origSet) deletions += cnt - Math.min(cnt, modSet.get(l) ?? 0);
    let additions = 0;
    for (const [l, cnt] of modSet) additions += cnt - Math.min(cnt, origSet.get(l) ?? 0);
    return { additions, deletions };
  }, [hasPending, activeFile, fileContents, pendingChanges]);

  // New pending files have no fileContents entry — treat as loaded (baseline is "")
  const contentLoaded  = activeFile in fileContents || activeFile in pendingChanges;
  const currentCode    = fileContents[activeFile] || "";
  const currentNode    = fileTree[activeFile];
  const currentLanguage = currentNode?.language || "plaintext";
  const monacoLang     = getMonacoLanguage(currentLanguage);
  const lineCount      = currentCode ? currentCode.split("\n").length : 0;
  const charCount      = currentCode.length;

  // ── Diagnostics counter ──────────────────────────────────────────────────
  const refreshDiagnostics = useCallback((monaco: any, editor: any) => {
    if (!monaco || !editor) return;
    const model = editor.getModel?.();
    if (!model) return;
    const markers = monaco.editor.getModelMarkers({ resource: model.uri });
    let errors = 0, warnings = 0;
    for (const m of markers) {
      if (m.severity === monaco.MarkerSeverity.Error) errors++;
      else if (m.severity === monaco.MarkerSeverity.Warning) warnings++;
    }
    setDiagnostics({ errors, warnings });
  }, []);

  const runLint = useCallback(async (fileId: string, code: string, language: string) => {
    if (!monacoRef.current || !editorRef.current) return;
    const monaco = monacoRef.current;
    const model = editorRef.current.getModel?.();
    if (!model) return;

    try {
      const res = await fetch("/api/lint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, language }),
      });
      const data = await res.json();
      const rawMarkers: any[] = data.markers ?? [];

      const monacoMarkers = rawMarkers.map((m: any) => {
        const word = model.getWordAtPosition?.({ lineNumber: m.line, column: m.col });
        const endColumn = word ? word.endColumn : m.col + 1;
        return {
          startLineNumber: m.line,
          startColumn: m.col,
          endLineNumber: m.line,
          endColumn,
          message: m.message,
          severity: m.severity === "warning"
            ? monaco.MarkerSeverity.Warning
            : monaco.MarkerSeverity.Error,
        };
      });
      monaco.editor.setModelMarkers(model, "sofi-lint", monacoMarkers);

      let errors = 0, warnings = 0;
      for (const m of rawMarkers) {
        if (m.severity === "warning") warnings++;
        else errors++;
      }
      setFileDiagnostics(fileId, { errors, warnings });
      setProblemMarkers(rawMarkers as ProblemMarker[]);
    } catch {}
  }, [setFileDiagnostics]);

  // ── Editor callbacks ─────────────────────────────────────────────────────
  const handleEditorMount = useCallback((editor: any, monaco: any) => {
    setupMonaco(monaco);
    monacoRef.current = monaco;
    editorRef.current = editor;

    markerDisposable.current?.dispose();
    markerDisposable.current = monaco.editor.onDidChangeMarkers(() => {
      refreshDiagnostics(monaco, editor);
    });
    refreshDiagnostics(monaco, editor);

    // Lint the file on open
    const model = editor.getModel?.();
    if (model) {
      const code = model.getValue();
      if (code) runLint(activeFile, code, currentLanguage);
    }

    // Intercept large pastes before Monaco processes them — prevents browser freeze
    const handleLargePaste = async (text: string) => {
      const proj = projectNameRef.current;
      const file = activeFileRef.current;
      if (!proj || !file) return;
      const sizeMB = (text.length / 1024 / 1024).toFixed(1);
      const saving = `// Salvando ${sizeMB} MB direto no arquivo...`;
      suppressSaveRef.current = true;
      editor.setValue(saving);
      // Update store so polling sees no mismatch against the placeholder
      useIDEStore.getState().updateFileContent(file, saving);
      useIDEStore.getState().markUserEdit(file);
      try {
        await fetch(
          `/api/upload?project=${encodeURIComponent(proj)}&path=${encodeURIComponent(file)}`,
          { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: new Blob([text]) }
        );
        const saved = `// Arquivo salvo (${sizeMB} MB).\n// Conteúdo grande demais para exibir no editor.`;
        suppressSaveRef.current = true;
        editor.setValue(saved);
        useIDEStore.getState().updateFileContent(file, saved);
        useIDEStore.getState().markUserEdit(file);
      } catch {
        const err = `// Erro ao salvar. Tente importar o arquivo diretamente.`;
        suppressSaveRef.current = true;
        editor.setValue(err);
        useIDEStore.getState().updateFileContent(file, err);
      }
    };

    const domNode = editor.getDomNode?.();
    if (domNode) {
      domNode.addEventListener("paste", (e: ClipboardEvent) => {
        const text = e.clipboardData?.getData("text") ?? "";
        if (text.length < 128 * 1024) return;
        e.preventDefault();
        e.stopPropagation();
        handleLargePaste(text);
      }, true);
    }
  }, [refreshDiagnostics, runLint, activeFile, currentLanguage]);

  const handleDiffEditorMount = useCallback((editor: any, monaco: any) => {
    diffEditorRef.current = editor;
    monacoRef.current = monaco;
    setupMonaco(monaco);
    setDiagnostics({ errors: 0, warnings: 0 });
    const target = pendingRevealRef.current;
    if (target) {
      pendingRevealRef.current = null;
      const disp = editor.onDidUpdateDiff?.(() => {
        editor.getModifiedEditor?.()?.revealLineInCenter(target.modLine);
        disp?.dispose();
      });
    }
  }, []);

  const handleCodeChange = useCallback(
    (value: string | undefined) => {
      if (!activeFile || value === undefined) return;
      if (suppressSaveRef.current) { suppressSaveRef.current = false; return; }

      // Fallback: if large content reached Monaco (paste interceptor missed it),
      // revert Monaco and upload directly to avoid freeze and polling mismatch
      if (value.length >= 128 * 1024) {
        const proj = projectName;
        const file = activeFile;
        const sizeMB = (value.length / 1024 / 1024).toFixed(1);
        const saved = `// Arquivo salvo (${sizeMB} MB).\n// Conteúdo grande demais para exibir no editor.`;
        suppressSaveRef.current = true;
        editorRef.current?.setValue(saved);
        updateFileContent(file, saved);
        markUserEdit(file);
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        fetch(
          `/api/upload?project=${encodeURIComponent(proj)}&path=${encodeURIComponent(file)}`,
          { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: new Blob([value]) }
        ).then(() => {
          useIDEStore.getState().markUserEdit(file);
        });
        return;
      }

      updateFileContent(activeFile, value);
      markUserEdit(activeFile);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(async () => {
        await fetch("/api/files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "write", project: projectName, filePath: activeFile, content: value }),
        });
      }, 500);
      if (lintTimerRef.current) clearTimeout(lintTimerRef.current);
      lintTimerRef.current = setTimeout(() => {
        runLint(activeFile, value, currentLanguage);
      }, 700);
    },
    [activeFile, projectName, currentLanguage, updateFileContent, markUserEdit, runLint]
  );

  async function handleRun() {
    if (!activeFile || isRunning) return;
    setIsRunning(true);
    setLintErrors([]);
    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: currentCode, language: currentLanguage }),
      });
      const data = await res.json();
      window.dispatchEvent(new CustomEvent("sofi-run-output", {
        detail: { filename: currentNode?.name || activeFile, output: data.output, error: data.error },
      }));
    } finally {
      setIsRunning(false);
    }
  }

  // ── Hunk navigation ──────────────────────────────────────────────────────
  function goToHunk(direction: "next" | "prev") {
    if (allHunks.length === 0) return;
    const nextIdx = direction === "next"
      ? (safeIdx + 1) % allHunks.length
      : (safeIdx - 1 + allHunks.length) % allHunks.length;
    setCurrentHunkIdx(nextIdx);
    const hunk = allHunks[nextIdx];

    if (activeFile === hunk.fileId) {
      // Same file — scroll directly
      diffEditorRef.current?.getModifiedEditor?.()?.revealLineInCenter(hunk.modLine);
    } else {
      // Different file — store reveal target, then open
      pendingRevealRef.current = hunk;
      openFile(hunk.fileId);
    }
  }

  const currentHunkFileId = allHunks.length > 0 ? allHunks[safeIdx].fileId : "";

  // ── Active file metadata for breadcrumb ────────────────────────────────
  const activePath = activeFile || "";
  const pathParts = activePath ? activePath.split("/") : [];
  const activeCode = (pendingChanges[activeFile] ?? fileContents[activeFile] ?? "") as string;
  const activeLineCount = activeCode ? activeCode.split("\n").length : 0;
  const byteCount = activeCode ? new TextEncoder().encode(activeCode).length : 0;

  return (
    <div className="flex-1 h-full bg-ide-bg flex flex-col overflow-hidden relative">
      {/* ── Folio: OPEN label + numbered tabs ───────────────────────────── */}
      <div className="flex items-stretch h-[44px] min-h-[44px] border-b shrink-0" style={{ borderColor: "rgba(245,245,245,0.06)", background: "#0a0a0a" }}>
        <div className="flex items-center pl-5 pr-3 shrink-0">
          <span className="font-mono text-[9px] uppercase tracking-[0.32em]" style={{ color: "rgba(245,245,245,0.4)", fontWeight: 600 }}>
            OPEN
          </span>
        </div>
        <div className="flex overflow-x-auto h-full editor-tabs-scroll items-center gap-5 pr-3">
          {openFiles.map((fileId, i) => {
            const node = fileTree[fileId];
            const name = node?.name || fileId.split("/").pop() || fileId;
            const dotIdx = name.lastIndexOf(".");
            const baseName = dotIdx > 0 ? name.slice(0, dotIdx) : name;
            const ext = dotIdx > 0 ? name.slice(dotIdx) : "";
            const isActive = activeFile === fileId;
            const hasChange = fileId in pendingChanges;
            const tabIsNew = hasChange && !(fileId in fileContents);
            const tabIsDeleted = hasChange && fileId in fileContents && !(fileId in fileTree);
            const num = String(i + 1).padStart(2, "0");
            return (
              <div
                key={fileId}
                className="group relative flex items-baseline gap-1.5 shrink-0 h-full"
              >
                <button
                  onClick={() => openFile(fileId)}
                  className="flex items-baseline gap-1.5 h-full pt-[15px]"
                >
                  <span
                    className="font-mono text-[10px] tabular-nums"
                    style={{ color: isActive ? "#ffffff" : "rgba(245,245,245,0.32)" }}
                  >
                    {num}
                  </span>
                  <span
                    className="font-serif text-[15px] leading-none"
                    style={{
                      color: tabIsDeleted ? "#d45f6a"
                        : isActive ? "#ffffff"
                        : "rgba(245,245,245,0.5)",
                      fontStyle: isActive ? "normal" : "normal",
                      fontWeight: isActive ? 600 : 400,
                      textDecoration: tabIsDeleted ? "line-through" : "none",
                    }}
                  >
                    {baseName}
                  </span>
                  <span
                    className="font-mono text-[10px]"
                    style={{ color: isActive ? "rgba(255,255,255,0.5)" : "rgba(245,245,245,0.3)" }}
                  >
                    {ext}
                  </span>
                  {hasChange && (
                    <span
                      className="w-1 h-1 rounded-full"
                      style={{ background: tabIsNew ? "#5a9e72" : tabIsDeleted ? "#d45f6a" : "#ffffff" }}
                    />
                  )}
                </button>
                <button
                  onClick={() => closeFile(fileId)}
                  className={`w-4 h-4 flex items-center justify-center pt-[15px] transition-opacity ${
                    isActive ? "opacity-60 hover:opacity-100" : "opacity-0 group-hover:opacity-60 hover:!opacity-100"
                  }`}
                  style={{ color: "rgba(245,245,245,0.6)" }}
                  title="Close"
                >
                  <X size={10} />
                </button>
              </div>
            );
          })}
        </div>
        <div className="flex-1" />
        {!isImageFile(activeFile) && activeFile && (
          <button
            onClick={handleRun}
            disabled={isRunning || !activeFile}
            className="flex items-center gap-1.5 px-4 h-full font-mono text-[9.5px] uppercase tracking-[0.22em] border-l disabled:opacity-40 transition-colors"
            style={{ borderColor: "rgba(245,245,245,0.06)", color: "#ffffff" }}
          >
            {isRunning
              ? <Loader2 size={10} className="animate-spin-custom" />
              : <span style={{ color: "rgba(255,255,255,0.6)" }}>▶</span>
            }
            <span>{isRunning ? "running" : "run · ⌘R"}</span>
          </button>
        )}
      </div>

      {/* ── Editor rail (breadcrumb) ───────────────────────────────────── */}
      {activeFile && (
        <div className="flex items-center gap-2.5 h-[32px] px-5 border-b shrink-0" style={{ borderColor: "rgba(245,245,245,0.06)", background: "rgba(255,255,255,0.02)" }}>
          <span className="font-mono text-[10px]" style={{ color: "rgba(255,255,255,0.6)" }}>§</span>
          <span className="font-mono text-[11px]" style={{ color: "rgba(245,245,245,0.85)", letterSpacing: "0.04em" }}>
            {pathParts.map((part, i) => {
              const isLast = i === pathParts.length - 1;
              return (
                <span key={i}>
                  <span style={{ color: isLast ? "#ffffff" : "rgba(245,245,245,0.5)" }}>{part}</span>
                  {!isLast && <span style={{ color: "rgba(245,245,245,0.3)", margin: "0 6px" }}>/</span>}
                </span>
              );
            })}
          </span>
          <span className="flex-1" />
          {!isImageFile(activeFile) && contentLoaded && (
            <span className="font-mono text-[9.5px] uppercase tracking-[0.18em] flex items-center gap-3" style={{ color: "rgba(245,245,245,0.4)" }}>
              <span className="tabular-nums">{byteCount} b</span>
              <span style={{ color: "rgba(245,245,245,0.2)" }}>·</span>
              <span className="tabular-nums">{activeLineCount} lines</span>
              <span style={{ color: "rgba(245,245,245,0.2)" }}>·</span>
              <span>utf-8</span>
              {hasPending && (
                <>
                  <span style={{ color: "rgba(245,245,245,0.2)" }}>·</span>
                  <span style={{ color: "#ffffff" }}>edits</span>
                </>
              )}
            </span>
          )}
        </div>
      )}

      {/* Editor area */}
      <div className="flex-1 min-h-[300px] overflow-hidden editor-monaco-wrap flex flex-col">
        {activeFile && isImageFile(activeFile) ? (
          <ImageViewer
            fileName={fileTree[activeFile]?.name || activeFile.split("/").pop() || activeFile}
            dataUrl={fileContents[activeFile] ?? pendingChanges[activeFile] ?? ""}
          />
        ) : activeFile && contentLoaded && hasPending && (currentCode.length >= 128 * 1024 || (pendingChanges[activeFile]?.length ?? 0) >= 128 * 1024) ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-ide-text-soft text-[13px]">
            <span>File too large to show diff.</span>
            <div className="flex gap-2">
              <button
                className="px-3 py-1.5 rounded bg-green-600 hover:bg-green-500 text-white text-[12px]"
                onClick={() => useIDEStore.getState().acceptChange(activeFile)}
              >Accept</button>
              <button
                className="px-3 py-1.5 rounded bg-ide-surface hover:bg-ide-elevated border border-ide-border text-[12px]"
                onClick={() => useIDEStore.getState().discardChange(activeFile)}
              >Discard</button>
            </div>
          </div>
        ) : activeFile && contentLoaded && hasPending ? (
          <MonacoDiffEditor
            key={`diff-${activeFile}`}
            original={currentCode}
            modified={pendingChanges[activeFile]}
            language={monacoLang}
            theme="vs-dark"
            onMount={handleDiffEditorMount}
            options={{
              readOnly: true,
              renderSideBySide: false,
              minimap: { enabled: false },
              fontSize: 14,
              fontFamily: "'JetBrains Mono', 'Cascadia Code', Consolas, 'Courier New', monospace",
              fontLigatures: true,
              wordWrap: "on",
              automaticLayout: true,
              padding: { top: 8 },
              scrollBeyondLastLine: false,
              renderIndicators: true,
              scrollbar: { vertical: "visible", horizontal: "hidden", verticalScrollbarSize: 8, horizontalScrollbarSize: 0 },
            }}
          />
        ) : activeFile && contentLoaded ? (
          <MonacoEditor
            key={activeFile}
            path={activeFile}
            defaultValue={currentCode}
            language={monacoLang}
            theme="vs-dark"
            onChange={handleCodeChange}
            onMount={handleEditorMount}
            options={{
              minimap: { enabled: true },
              fontSize: 14,
              fontFamily: "'JetBrains Mono', 'Cascadia Code', Consolas, 'Courier New', monospace",
              fontLigatures: true,
              wordWrap: "on",
              automaticLayout: true,
              tabSize: 4,
              insertSpaces: true,
              padding: { top: 8 },
              scrollBeyondLastLine: false,
              scrollbar: { vertical: "hidden", horizontal: "hidden", verticalScrollbarSize: 0, horizontalScrollbarSize: 0, useShadows: false },
              quickSuggestions: { other: true, comments: false, strings: true },
              suggestOnTriggerCharacters: true,
              acceptSuggestionOnEnter: "on",
              tabCompletion: "on",
              wordBasedSuggestions: "currentDocument",
              parameterHints: { enabled: true },
              inlineSuggest: { enabled: true },
              suggest: {
                showKeywords: true, showSnippets: true, showFunctions: true,
                showClasses: true, showVariables: true, showModules: true,
                showMethods: true, showProperties: true, showConstructors: true,
                showFields: true, preview: true, filterGraceful: true, insertMode: "replace",
              },
            }}
          />
        ) : activeFile && !contentLoaded && !(activeFile in pendingChanges) ? (
          <div className="flex-1 flex items-center justify-center h-full text-ide-muted text-[13px]">
            <Loader2 size={14} className="animate-spin-custom mr-2 text-accent" />
            Loading file…
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center h-full px-8 select-none">
            <p className="text-[13px] text-ide-text-soft">No file open</p>
            <p className="text-[12px] text-ide-muted mt-1.5">Pick a file from the explorer to begin</p>
          </div>
        )}
      </div>

      {/* Pending changes toolbar */}
      {pendingCount > 0 && (
        <div className="flex flex-col border-t shrink-0" style={{ background: "#0a0a0a", borderColor: "rgba(245,245,245,0.08)" }}>
          {/* Header */}
          <div className="flex items-center gap-2.5 px-4 pt-2.5 pb-1.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.32em] shrink-0" style={{ color: "rgba(245,245,245,0.5)", fontWeight: 600 }}>
              {pendingCount === 1 ? "Pending change" : `${pendingCount} pending`}
            </span>
            {pendingCount > 1 && (
              <div className="flex items-center gap-1.5 overflow-x-auto editor-tabs-scroll pl-1">
                {pendingFileIds.map((fileId) => {
                  const node = fileTree[fileId];
                  const name = node?.name || fileId.split("/").pop() || fileId;
                  const isViewing = activeFile === fileId;
                  const chipIsNew = !(fileId in fileContents);
                  const chipIsDeleted = fileId in fileContents && !(fileId in fileTree);
                  const chipColor = chipIsNew ? "#5a9e72" : chipIsDeleted ? "#d45f6a" : "#ffffff";
                  return (
                    <button
                      key={fileId}
                      onClick={() => openFile(fileId)}
                      className="flex items-center gap-1.5 px-2 h-6 shrink-0 transition-colors"
                      style={{
                        background: isViewing ? "rgba(255,255,255,0.07)" : "transparent",
                        border: `1px solid ${isViewing ? "rgba(245,245,245,0.18)" : "rgba(245,245,245,0.08)"}`,
                      }}
                      title={fileId}
                    >
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: chipColor }} />
                      <span
                        className="font-mono text-[11px] truncate max-w-[140px]"
                        style={{
                          color: isViewing ? "#ffffff" : "rgba(245,245,245,0.6)",
                          textDecoration: chipIsDeleted ? "line-through" : "none",
                        }}
                      >
                        {name}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Action row */}
          <div className="flex items-center h-11 min-h-[44px] px-4 gap-3">
            {/* Hunk navigation */}
            <div className="flex items-center gap-0" style={{ border: "1px solid rgba(245,245,245,0.1)" }}>
              <button
                onClick={() => goToHunk("prev")}
                className="w-6 h-6 flex items-center justify-center hover:bg-ide-hover transition-colors"
                style={{ color: "rgba(245,245,245,0.6)" }}
                title="Previous change"
              >
                <ChevronUp size={11} />
              </button>
              <span className="font-mono text-[10px] tabular-nums px-2 min-w-[44px] text-center" style={{ color: "rgba(245,245,245,0.7)", borderLeft: "1px solid rgba(245,245,245,0.08)", borderRight: "1px solid rgba(245,245,245,0.08)" }}>
                {allHunks.length > 0 ? `${safeIdx + 1} / ${allHunks.length}` : "0 / 0"}
              </span>
              <button
                onClick={() => goToHunk("next")}
                className="w-6 h-6 flex items-center justify-center hover:bg-ide-hover transition-colors"
                style={{ color: "rgba(245,245,245,0.6)" }}
                title="Next change"
              >
                <ChevronDown size={11} />
              </button>
            </div>

            {/* Diff stats / type */}
            {hasPending && (
              <div className="flex items-center gap-2.5">
                {isNewFile && (
                  <span className="font-mono text-[9.5px] uppercase tracking-[0.22em] px-1.5 py-0.5" style={{ color: "#5a9e72", border: "1px solid rgba(90,158,114,0.35)", fontWeight: 700 }}>
                    new
                  </span>
                )}
                {isDeletedFile && (
                  <span className="font-mono text-[9.5px] uppercase tracking-[0.22em] px-1.5 py-0.5" style={{ color: "#d45f6a", border: "1px solid rgba(212,95,106,0.35)", fontWeight: 700 }}>
                    deleted
                  </span>
                )}
                <span className="flex items-center gap-0.5 font-mono text-[10.5px] tabular-nums" style={{ color: "#5a9e72" }}>
                  <Plus size={10} strokeWidth={2.4} />{pendingStats.additions}
                </span>
                <span className="flex items-center gap-0.5 font-mono text-[10.5px] tabular-nums" style={{ color: "#d45f6a" }}>
                  <Minus size={10} strokeWidth={2.4} />{pendingStats.deletions}
                </span>
              </div>
            )}

            <div className="flex-1" />

            {currentHunkFileId && (
              <>
                <button
                  onClick={() => discardChange(currentHunkFileId)}
                  className="font-mono uppercase tracking-[0.18em] flex items-center gap-1.5 h-7 px-3 transition-colors hover:bg-ide-hover"
                  style={{ color: "rgba(245,245,245,0.7)", border: "1px solid rgba(245,245,245,0.1)", fontSize: 10.5, fontWeight: 600 }}
                  title="Discard"
                >
                  <Undo2 size={10} />
                  Discard
                </button>
                <button
                  onClick={() => acceptChange(currentHunkFileId)}
                  className="font-mono uppercase tracking-[0.18em] flex items-center gap-1.5 h-7 px-3 transition-colors"
                  style={{ color: "#0a0a0a", background: "#ffffff", fontSize: 10.5, fontWeight: 700 }}
                  title="Accept"
                >
                  <Check size={10} strokeWidth={3} />
                  Accept
                </button>
              </>
            )}

            {pendingCount > 1 && (
              <>
                <span className="w-px h-5" style={{ background: "rgba(245,245,245,0.1)" }} />
                <button
                  onClick={discardAllChanges}
                  className="font-mono uppercase tracking-[0.18em] flex items-center gap-1.5 h-7 px-2.5 transition-colors hover:bg-ide-hover"
                  style={{ color: "#d45f6a", border: "1px solid rgba(212,95,106,0.25)", fontSize: 10, fontWeight: 600 }}
                  title="Discard all changes"
                >
                  <XCircle size={10} />
                  Discard all
                </button>
                <button
                  onClick={acceptAllChanges}
                  className="font-mono uppercase tracking-[0.18em] flex items-center gap-1.5 h-7 px-2.5 transition-colors"
                  style={{ color: "#0a0a0a", background: "#ffffff", fontSize: 10, fontWeight: 700 }}
                  title="Accept all changes"
                >
                  <CheckCheck size={10} />
                  Accept all
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Problems panel */}
      {problemMarkers.length > 0 && (
        <div className="border-t border-ide-border shrink-0 bg-ide-panel">
          <div
            className="flex items-center gap-2 px-3 h-8 border-b border-ide-border cursor-pointer select-none hover:bg-ide-hover transition-colors"
            onClick={() => setProblemsOpen((o) => !o)}
          >
            {problemsOpen
              ? <ChevronDown size={11} className="text-ide-muted" />
              : <ChevronRight size={11} className="text-ide-muted" />}
            <span className="text-[10px] font-medium text-ide-text-soft uppercase tracking-widest">Problems</span>
            {diagnostics.errors > 0 && (
              <span className="flex items-center gap-1 text-[11px] text-severity-error font-medium font-mono tabular-nums">
                <XCircle size={11} /> {diagnostics.errors}
              </span>
            )}
            {diagnostics.warnings > 0 && (
              <span className="flex items-center gap-1 text-[11px] text-severity-warn font-medium font-mono tabular-nums">
                <AlertTriangle size={11} /> {diagnostics.warnings}
              </span>
            )}
            <div className="flex-1" />
            <button
              onClick={(e) => { e.stopPropagation(); setProblemMarkers([]); setDiagnostics({ errors: 0, warnings: 0 }); }}
              className="btn-icon !w-5 !h-5"
              title="Clear problems"
            >
              <X size={11} />
            </button>
          </div>
          {problemsOpen && (
            <div className="overflow-auto" style={{ maxHeight: 168 }}>
              {problemMarkers.map((m, i) => (
                <button
                  key={i}
                  onClick={() => navigateTo(m.line, m.col)}
                  className="w-full flex items-start gap-3 px-3 py-1.5 text-left hover:bg-ide-hover group transition-colors border-l-2 border-transparent hover:border-accent/60"
                >
                  {m.severity === "error"
                    ? <XCircle size={12} className="text-severity-error mt-0.5 shrink-0" />
                    : <AlertTriangle size={12} className="text-severity-warn mt-0.5 shrink-0" />
                  }
                  <span className="text-[12px] text-ide-text-soft flex-1 leading-snug group-hover:text-ide-text transition-colors">
                    {m.message}
                  </span>
                  <span className="text-[10.5px] text-ide-muted font-mono shrink-0 tabular-nums group-hover:text-ide-text-soft transition-colors">
                    {m.line}:{m.col}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Status Bar */}
      <div className="flex items-center h-6 min-h-[24px] px-2.5 border-t border-ide-border bg-ide-panel text-[11px] text-ide-muted">
        <div className="flex items-center gap-2.5">
          <span className="font-mono uppercase tracking-wider text-[10px]">{currentLanguage}</span>
          {!isImageFile(activeFile) && <span className="font-mono text-[10px]">UTF-8</span>}
        </div>
        {!isImageFile(activeFile) && (
          <div className="flex items-center gap-2.5 ml-3">
            {diagnostics.errors > 0 && (
              <span className="flex items-center gap-1 text-severity-error tabular-nums">
                <XCircle size={10} />
                {diagnostics.errors}
              </span>
            )}
            {diagnostics.warnings > 0 && (
              <span className="flex items-center gap-1 text-severity-warn tabular-nums">
                <AlertTriangle size={10} />
                {diagnostics.warnings}
              </span>
            )}
          </div>
        )}
        <div className="flex-1" />
        <div className="flex items-center gap-3 font-mono tabular-nums text-[10px]">
          {pendingCount > 0 && (
            <span className="flex items-center gap-1 text-accent">
              {pendingCount} pending
            </span>
          )}
          {!isImageFile(activeFile) && (
            <>
              <span>Ln {lineCount}</span>
              <span>{charCount.toLocaleString()} chars</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
