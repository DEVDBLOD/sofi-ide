"use client";

import { useIDEStore, FileNode } from "@/store/useIDEStore";
import {
  Folder,
  FolderOpen,
  ChevronDown,
  ChevronRight,
  FilePlus,
  FolderPlus,
  Pencil,
  Trash2,
  RefreshCw,
  Check,
  X,
  Loader2,
  XCircle,
  AlertTriangle,
  FileCode2,
} from "lucide-react";
import { FileIcon } from "@/components/FileIcon";
import { useState, useCallback, useRef, useEffect } from "react";

export default function FileExplorer({ width = 260 }: { width?: number }) {
  const store = useIDEStore();
  const {
    fileTree,
    rootFiles,
    folderOpen,
    activeFile,
    openFile,
    toggleFolder,
    projectName,
    explorerBusy,
    setExplorerBusy,
    isRefreshing,
    setIsRefreshing,
    pendingChanges,
    fileDiagnostics,
  } = store;

  const [creatingIn, setCreatingIn] = useState("");
  const [creatingType, setCreatingType] = useState<"file" | "folder">("file");
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState("");
  const [renameValue, setRenameValue] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<{ ids: string[]; label: string } | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [anchorFile, setAnchorFile] = useState<string | null>(null);

  useEffect(() => {
    const handler = () => { if (projectName) refreshFiles(); };
    window.addEventListener("sofi-files-uploaded", handler);
    return () => window.removeEventListener("sofi-files-uploaded", handler);
  }, [projectName]);

  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const dragCounterRef = useRef(0);

  function getVisibleFiles(): string[] {
    const result: string[] = [];
    function traverse(ids: string[]) {
      for (const id of ids) {
        const node = fileTree[id];
        if (!node) continue;
        if (node.type === "file") result.push(id);
        else if (node.type === "folder" && (folderOpen[id] ?? false)) traverse(node.children || []);
      }
    }
    traverse(rootFiles);
    return result;
  }

  const refreshFiles = useCallback(async () => {
    if (!projectName || isRefreshing) return;
    setIsRefreshing(true);
    try {
      const res = await fetch(`/api/files?project=${encodeURIComponent(projectName)}`);
      const data = await res.json();
      const current = useIDEStore.getState();
      const mergedFolderOpen = { ...(data.folderOpen || {}), ...current.folderOpen };
      useIDEStore.setState({
        fileTree: data.tree || {},
        rootFiles: data.rootFiles || [],
        folderOpen: mergedFolderOpen,
      });
    } finally { setIsRefreshing(false); }
  }, [projectName, isRefreshing]);

  async function handleCreate() {
    const name = newName.trim();
    if (!name || !creatingIn) return;
    setExplorerBusy(true);
    const filePath = creatingIn === "." ? name : `${creatingIn}/${name}`;
    await fetch("/api/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create", project: projectName, filePath, itemType: creatingType }),
    });
    setCreatingIn(""); setNewName("");
    setExplorerBusy(false);
    await refreshFiles();
    if (creatingType === "file") openFile(filePath);
  }

  async function handleRename() {
    const name = renameValue.trim();
    if (!name || !renamingId) return;
    setExplorerBusy(true);
    await fetch("/api/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "rename", project: projectName, filePath: renamingId, newName: name }),
    });
    setRenamingId(""); setRenameValue("");
    setExplorerBusy(false);
    await refreshFiles();
  }

  function requestDelete(itemId: string) {
    const node = fileTree[itemId];
    setDeleteConfirm({ ids: [itemId], label: node?.name || itemId });
  }

  async function confirmDelete() {
    if (!deleteConfirm) return;
    const ids = deleteConfirm.ids;
    setDeleteConfirm(null);
    setExplorerBusy(true);
    await Promise.all(
      ids.map((id) =>
        fetch("/api/files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "delete", project: projectName, filePath: id }),
        })
      )
    );
    useIDEStore.setState((s) => {
      let fileContents = { ...s.fileContents };
      let pendingChanges = { ...s.pendingChanges };
      let openFiles = [...s.openFiles];
      let activeFile = s.activeFile;
      for (const deletedId of ids) {
        const prefix = deletedId + "/";
        const isDeleted = (k: string) => k === deletedId || k.startsWith(prefix);
        fileContents = Object.fromEntries(Object.entries(fileContents).filter(([k]) => !isDeleted(k)));
        pendingChanges = Object.fromEntries(Object.entries(pendingChanges).filter(([k]) => !isDeleted(k)));
        openFiles = openFiles.filter((f) => !isDeleted(f));
        if (isDeleted(activeFile)) activeFile = openFiles[openFiles.length - 1] || "";
      }
      return { fileContents, pendingChanges, openFiles, activeFile };
    });
    setSelectedFiles(new Set());
    setExplorerBusy(false);
    await refreshFiles();
  }

  async function handleMove(sourceId: string, targetFolderId: string) {
    if (!sourceId || !targetFolderId) return;
    const sourceName = sourceId.includes("/") ? sourceId.split("/").pop()! : sourceId;
    const destPath = targetFolderId === "." ? sourceName : `${targetFolderId}/${sourceName}`;
    if (destPath === sourceId) return;
    if (targetFolderId === sourceId || targetFolderId.startsWith(sourceId + "/")) return;
    setExplorerBusy(true);
    try {
      await fetch("/api/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "move", project: projectName, filePath: sourceId, destPath }),
      });
      await refreshFiles();
    } catch {} finally { setExplorerBusy(false); }
  }

  function handleDragStart(e: React.DragEvent, nodeId: string) {
    setDraggedId(nodeId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", nodeId);
    (window as any).__sofiInternalDrag = true;
    if (e.currentTarget instanceof HTMLElement) e.currentTarget.style.opacity = "0.5";
  }
  function handleDragEnd(e: React.DragEvent) {
    if (e.currentTarget instanceof HTMLElement) e.currentTarget.style.opacity = "1";
    (window as any).__sofiInternalDrag = false;
    setDraggedId(null); setDropTargetId(null); dragCounterRef.current = 0;
  }
  function handleDragEnter(e: React.DragEvent, folderId: string) {
    e.preventDefault(); e.stopPropagation();
    dragCounterRef.current++;
    if (draggedId && folderId !== draggedId) setDropTargetId(folderId);
  }
  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault(); e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) setDropTargetId(null);
  }
  function handleDragOver(e: React.DragEvent) {
    e.preventDefault(); e.dataTransfer.dropEffect = "move";
  }
  function handleDrop(e: React.DragEvent, targetFolderId: string) {
    e.preventDefault(); e.stopPropagation();
    dragCounterRef.current = 0; setDropTargetId(null);
    const sourceId = e.dataTransfer.getData("text/plain");
    if (sourceId && targetFolderId !== sourceId) handleMove(sourceId, targetFolderId);
    setDraggedId(null);
  }

  function handleFileClick(e: React.MouseEvent, nodeId: string) {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setSelectedFiles((prev) => {
        const next = new Set(prev);
        if (next.has(nodeId)) next.delete(nodeId);
        else next.add(nodeId);
        return next;
      });
      setAnchorFile(nodeId);
    } else if (e.shiftKey && anchorFile) {
      e.preventDefault();
      const visible = getVisibleFiles();
      const anchorIdx = visible.indexOf(anchorFile);
      const currentIdx = visible.indexOf(nodeId);
      if (anchorIdx !== -1 && currentIdx !== -1) {
        const [from, to] = anchorIdx <= currentIdx ? [anchorIdx, currentIdx] : [currentIdx, anchorIdx];
        setSelectedFiles(new Set(visible.slice(from, to + 1)));
      }
    } else {
      setSelectedFiles(new Set([nodeId]));
      setAnchorFile(nodeId);
      openFile(nodeId);
    }
  }

  function renderNode(nodeId: string, depth: number) {
    const node = fileTree[nodeId];
    if (!node) return null;

    const pad = `${10 + depth * 14}px`;
    const isFolder = node.type === "folder";
    const isOpen = folderOpen[nodeId] ?? false;
    const isActive = activeFile === nodeId;
    const isSelected = selectedFiles.has(nodeId);
    const isDragged = draggedId === nodeId;
    const isDropTarget = dropTargetId === nodeId;

    if (renamingId === nodeId) {
      return (
        <div key={nodeId} className="flex items-center gap-1.5 px-2 py-1 bg-ide-elevated border-l-2 border-accent">
          {isFolder ? <Folder size={12.5} className="text-accent shrink-0" /> : <FileCode2 size={12.5} className="text-accent shrink-0" />}
          <input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRename();
              if (e.key === "Escape") { setRenamingId(""); setRenameValue(""); }
            }}
            className="flex-1 h-5 px-1.5 text-[12px] text-ide-text bg-ide-surface border border-ide-border-strong rounded outline-none focus:border-accent min-w-0"
            autoFocus
          />
          <button onClick={handleRename} className="btn-icon !w-5 !h-5 !text-severity-ok"><Check size={11} /></button>
          <button onClick={() => { setRenamingId(""); setRenameValue(""); }} className="btn-icon !w-5 !h-5"><X size={11} /></button>
        </div>
      );
    }

    if (isFolder) {
      return (
        <div key={nodeId}>
          <div
            className={`explorer-item relative flex items-center pr-1 group transition-colors ${
              isDropTarget ? "bg-accent-glow ring-1 ring-accent/40 ring-inset"
                : "hover:bg-ide-hover"
            } ${isDragged ? "opacity-40" : ""}`}
            draggable={nodeId !== "."}
            onDragStart={(e) => handleDragStart(e, nodeId)}
            onDragEnd={handleDragEnd}
            onDragEnter={(e) => handleDragEnter(e, nodeId)}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, nodeId)}
          >
            <button
              onClick={() => toggleFolder(nodeId)}
              className="flex-1 flex items-center gap-1.5 py-[3px] bg-transparent min-w-0 text-left"
              style={{ paddingLeft: pad, height: 22 }}
            >
              <span className="w-3 text-center font-mono text-[9px] shrink-0" style={{ color: "rgba(245,245,245,0.55)" }}>
                {isOpen ? "▾" : "▸"}
              </span>
              <span
                className="font-mono uppercase truncate"
                style={{ color: "#ffffff", fontWeight: 600, fontSize: 10, letterSpacing: "0.12em" }}
              >
                {node.name}
              </span>
            </button>
            <div className="explorer-actions flex shrink-0">
              <button onClick={() => { setCreatingIn(nodeId); setCreatingType("file"); setNewName(""); if (!isOpen) toggleFolder(nodeId); }} className="btn-icon !w-5 !h-5" title="New file"><FilePlus size={11} /></button>
              <button onClick={() => { setCreatingIn(nodeId); setCreatingType("folder"); setNewName(""); }} className="btn-icon !w-5 !h-5" title="New folder"><FolderPlus size={11} /></button>
              {nodeId !== "." && <button onClick={() => { setRenamingId(nodeId); setRenameValue(node.name); }} className="btn-icon !w-5 !h-5" title="Rename"><Pencil size={11} /></button>}
              {nodeId !== "." && <button onClick={() => requestDelete(nodeId)} className="btn-icon !w-5 !h-5 hover:!text-severity-error" title="Delete"><Trash2 size={11} /></button>}
            </div>
          </div>
          {isOpen && node.children?.map((childId) => renderNode(childId, depth + 1))}
        </div>
      );
    }

    // File row
    const hasPendingChange = nodeId in pendingChanges;
    const diag = fileDiagnostics[nodeId];
    const hasErrors = !!diag && diag.errors > 0;
    const hasWarnings = !!diag && diag.warnings > 0;

    return (
      <div
        key={nodeId}
        className={`explorer-item relative flex items-center pr-1 transition-colors ${
          isActive ? "bg-ide-active"
          : isSelected ? "bg-accent/10 ring-1 ring-inset ring-accent/25"
          : "hover:bg-ide-hover"
        } ${isDragged ? "opacity-40" : ""}`}
        draggable
        onDragStart={(e) => handleDragStart(e, nodeId)}
        onDragEnd={handleDragEnd}
      >
        {isActive && <span className="absolute left-0 top-0 bottom-0 w-[2px]" style={{ background: "#ffffff" }} />}
        <button
          onClick={(e) => handleFileClick(e, nodeId)}
          className="flex-1 flex items-center gap-1.5 py-[3px] bg-transparent min-w-0 text-left"
          style={{ paddingLeft: pad, height: 22 }}
        >
          <span className="w-3 shrink-0" />
          {hasErrors
            ? <XCircle size={11} className="shrink-0" style={{ color: "#d45f6a" }} />
            : <FileIcon
                name={node.name}
                size={11}
                className="shrink-0"
                style={{ color: isActive || isSelected ? "#ffffff" : "rgba(255,255,255,0.7)" }}
              />
          }
          <span
            className="font-mono truncate"
            style={{
              color: isActive ? "#ffffff"
                : isSelected ? "#ffffff"
                : hasErrors ? "#d45f6a"
                : hasPendingChange ? "#ffffff"
                : "rgba(245,245,245,0.72)",
              fontWeight: isActive || isSelected ? 600 : 400,
              fontSize: 11,
              letterSpacing: "0.01em",
            }}
          >
            {node.name}
          </span>
          {hasErrors && (
            <span
              className="ml-auto font-mono text-[9px] px-1 tabular-nums shrink-0"
              style={{ color: "#d45f6a", background: "rgba(212,95,106,0.12)", fontWeight: 700 }}
            >
              {diag!.errors}
            </span>
          )}
          {!hasErrors && hasWarnings && (
            <span
              className="ml-auto font-mono text-[9px] px-1 tabular-nums shrink-0"
              style={{ color: "#d4a050", background: "rgba(212,160,80,0.12)", fontWeight: 700 }}
            >
              {diag!.warnings}
            </span>
          )}
          {hasPendingChange && !hasErrors && !hasWarnings && (
            <span
              className="ml-auto font-mono text-[9px] px-1 shrink-0"
              style={{ color: "#ffffff", background: "rgba(255,255,255,0.08)", fontWeight: 700 }}
            >
              M
            </span>
          )}
          {hasPendingChange && !hasErrors && (
            <span className="w-1.5 h-1.5 rounded-full bg-severity-info shrink-0 shadow-[0_0_6px_rgba(110,197,245,0.6)]" />
          )}
          {hasErrors && (
            <span className="flex items-center gap-0.5 shrink-0 text-severity-error text-[10px] font-mono font-medium tabular-nums">
              <XCircle size={10} />
              {diag!.errors}
            </span>
          )}
          {!hasErrors && hasWarnings && (
            <span className="flex items-center gap-0.5 shrink-0 text-severity-warn text-[10px] font-mono font-medium tabular-nums">
              <AlertTriangle size={10} />
              {diag!.warnings}
            </span>
          )}
        </button>
        <div className="explorer-actions flex shrink-0">
          <button onClick={() => { setRenamingId(nodeId); setRenameValue(node.name); }} className="btn-icon !w-5 !h-5" title="Rename"><Pencil size={11} /></button>
          <button onClick={() => requestDelete(nodeId)} className="btn-icon !w-5 !h-5 hover:!text-severity-error" title="Delete"><Trash2 size={11} /></button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ width, minWidth: 140, background: "#0a0a0a" }} className="h-full flex flex-col overflow-hidden relative">
      {/* EXPLORER bar */}
      <div className="flex items-center gap-1 px-3 h-8 border-b" style={{ borderColor: "rgba(245,245,245,0.06)" }}>
        <span className="font-mono text-[9px] uppercase tracking-[0.32em]" style={{ color: "rgba(245,245,245,0.5)", fontWeight: 600 }}>
          EXPLORER
        </span>
        {explorerBusy && <Loader2 size={9} className="animate-spin-custom shrink-0 ml-1" style={{ color: "#ffffff" }} />}
        <div className="flex-1" />
        {selectedFiles.size > 0 && (
          <>
            <span className="font-mono text-[9px]" style={{ color: "rgba(245,245,245,0.45)" }}>
              {selectedFiles.size} sel
            </span>
            <button
              onClick={() => {
                const ids = Array.from(selectedFiles);
                const label = ids.length === 1
                  ? (fileTree[ids[0]]?.name || ids[0])
                  : `${ids.length} items`;
                setDeleteConfirm({ ids, label });
              }}
              title={`Delete ${selectedFiles.size} selected`}
              className="btn-icon !w-5 !h-5 hover:!text-severity-error"
              disabled={explorerBusy}
            >
              <Trash2 size={10} />
            </button>
          </>
        )}
        <button onClick={() => { setCreatingIn("."); setCreatingType("file"); setNewName(""); }} title="New file" className="btn-icon !w-5 !h-5" disabled={explorerBusy}>
          <FilePlus size={10} />
        </button>
        <button onClick={() => { setCreatingIn("."); setCreatingType("folder"); setNewName(""); }} title="New folder" className="btn-icon !w-5 !h-5" disabled={explorerBusy}>
          <FolderPlus size={10} />
        </button>
        <button onClick={refreshFiles} title="Refresh" className="btn-icon !w-5 !h-5" disabled={explorerBusy}>
          <RefreshCw size={10} className={isRefreshing ? "animate-spin-custom" : ""} />
        </button>
      </div>

      {/* Project row */}
      <div className="flex items-center gap-1.5 px-3.5 py-2 border-b" style={{ borderColor: "rgba(245,245,245,0.04)" }}>
        <span className="font-mono text-[9px]" style={{ color: "rgba(255,255,255,0.7)" }}>▾</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: "#ffffff", fontWeight: 700 }}>
          {projectName || "no project"}
        </span>
        <span className="flex-1" />
        <span className="font-mono text-[9px] uppercase tracking-[0.18em]" style={{ color: "rgba(245,245,245,0.4)" }}>
          main
        </span>
      </div>

      {explorerBusy ? <div className="explorer-loading-bar" /> : <div className="h-px bg-ide-border" />}

      {/* Create panel */}
      {creatingIn && (
        <div className="flex items-center gap-1.5 px-2 py-1.5 bg-ide-elevated border-b border-ide-border animate-fade-in">
          {creatingType === "folder" ? <Folder size={12.5} className="text-accent shrink-0" /> : <FileCode2 size={12.5} className="text-accent shrink-0" />}
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
              if (e.key === "Escape") { setCreatingIn(""); setNewName(""); }
            }}
            placeholder={creatingType === "folder" ? "folder name" : "file name"}
            className="flex-1 h-5 px-1.5 text-[12px] text-ide-text bg-ide-surface border border-ide-border-strong rounded outline-none focus:border-accent min-w-0 placeholder:text-ide-faint"
            autoFocus
          />
          <button onClick={handleCreate} className="btn-icon !w-5 !h-5 !text-severity-ok"><Check size={11} /></button>
          <button onClick={() => { setCreatingIn(""); setNewName(""); }} className="btn-icon !w-5 !h-5"><X size={11} /></button>
        </div>
      )}

      {/* Tree */}
      <div
        className={`flex-1 overflow-y-auto py-1 transition-colors outline-none ${
          dropTargetId === "." ? "bg-accent-glow ring-1 ring-accent/30 ring-inset" : ""
        }`}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Delete" && selectedFiles.size > 0) {
            e.preventDefault();
            const ids = Array.from(selectedFiles);
            const label = ids.length === 1
              ? (fileTree[ids[0]]?.name || ids[0])
              : `${ids.length} items`;
            setDeleteConfirm({ ids, label });
          }
          if (e.key === "Escape") setSelectedFiles(new Set());
        }}
        onDragEnter={(e) => handleDragEnter(e, ".")}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={(e) => handleDrop(e, ".")}
      >
        {rootFiles.length === 0 ? (
          <div className="px-3 py-6 text-center">
            <p className="text-[11px] text-ide-faint">
              {projectName ? "No files yet" : "Select a project"}
            </p>
          </div>
        ) : (
          rootFiles.map((id) => renderNode(id, 0))
        )}
      </div>

      {/* Delete modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in" onClick={() => setDeleteConfirm(null)}>
          <div className="bg-ide-elevated border border-ide-border-strong w-[360px] rounded-xl shadow-modal animate-scale-in" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-ide-border">
              <span className="text-[13px] font-medium text-ide-text">Delete</span>
              <button onClick={() => setDeleteConfirm(null)} className="btn-icon !w-6 !h-6">
                <X size={13} />
              </button>
            </div>
            <div className="px-5 py-4 flex flex-col gap-4">
              <p className="text-[12.5px] text-ide-text-soft leading-relaxed">
                Delete <span className="text-ide-text font-medium font-mono px-1.5 py-0.5 bg-ide-surface rounded border border-ide-border">{deleteConfirm.label}</span>?
                <br />
                <span className="text-ide-muted text-[11.5px]">This action cannot be undone.</span>
              </p>
              <div className="flex items-center gap-2 justify-end">
                <button
                  onClick={() => setDeleteConfirm(null)}
                  className="px-3 h-8 text-[12px] text-ide-text-soft bg-transparent border border-ide-border rounded-md hover:bg-ide-hover transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDelete}
                  className="px-3 h-8 text-[12px] text-white bg-severity-error/90 rounded-md hover:bg-severity-error transition-colors font-medium"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
