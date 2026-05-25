"use client";

import { useIDEStore } from "@/store/useIDEStore";
import {
  Code2,
  Monitor,
  Settings,
  FolderPlus,
  Check,
  X,
  ChevronDown,
  Trash2,
  Upload,
  Download,
  LayoutGrid,
  MessageSquare,
} from "lucide-react";
import { useState, useRef } from "react";
import JSZip from "jszip";

export default function TopBar() {
  const {
    availableProjects,
    projectName,
    setProjectName,
    transferActive,
    transferProgress,
    transferStatus,
    transferType,
    currentView,
    setCurrentView,
  } = useIDEStore();

  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [showSelect, setShowSelect] = useState(false);
  const [deletingProject, setDeletingProject] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [zipModal, setZipModal] = useState<{ file: File; name: string } | null>(null);
  const [localProgress, setLocalProgress] = useState<{ active: boolean; progress: number; status: string; type: string }>({ active: false, progress: 0, status: "", type: "" });

  const transfer = localProgress.active ? localProgress : { active: transferActive, progress: transferProgress, status: transferStatus, type: transferType };
  const downloading = transfer.active && transfer.type === "download";

  async function handleSelectProject(name: string) {
    setShowSelect(false);
    setProjectName(name);
    try {
      const res = await fetch(`/api/files?project=${encodeURIComponent(name)}&contents=1`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      useIDEStore.getState().loadProject(data.tree, data.contents, data.rootFiles, data.folderOpen);
    } catch (err) {
      console.error("Failed to load project files:", err);
    }
  }

  async function handleDeleteProject(name: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (deletingProject) return;
    if (!confirm(`Delete project "${name}"? This cannot be undone.`)) return;
    setDeletingProject(name);
    try {
      await fetch("/api/projects", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const res = await fetch("/api/projects");
      const data = await res.json();
      const projects = data.projects || [];
      useIDEStore.getState().setAvailableProjects(projects);
      if (projectName === name) {
        if (projects.length > 0) handleSelectProject(projects[0]);
        else { setProjectName(""); useIDEStore.getState().loadProject({}, {}, [], {}); }
      }
    } finally { setDeletingProject(null); }
  }

  async function handleCreateProject() {
    const name = newName.trim();
    if (!name) return;
    await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setIsCreating(false);
    setNewName("");
    const res = await fetch("/api/projects");
    const data = await res.json();
    useIDEStore.getState().setAvailableProjects(data.projects);
    handleSelectProject(name);
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    if (fileInputRef.current) fileInputRef.current.value = "";
    const zips = files.filter((f) => f.name.toLowerCase().endsWith(".zip"));
    const others = files.filter((f) => !f.name.toLowerCase().endsWith(".zip"));
    // Single ZIP only → show modal
    if (zips.length === 1 && others.length === 0) {
      const name = zips[0].name.replace(/\.zip$/i, "").replace(/[^a-zA-Z0-9_-]/g, "_");
      setZipModal({ file: zips[0], name });
    } else {
      importMultipleFiles(files);
    }
  }

  async function importMultipleFiles(files: File[]) {
    if (!projectName) { alert("Open a project first before importing files."); return; }
    const prog = (pct: number, msg: string) => setLocalProgress({ active: true, progress: pct, status: msg, type: "import" });
    const done = () => setTimeout(() => setLocalProgress({ active: false, progress: 0, status: "", type: "" }), 1200);
    const failed: string[] = [];
    const succeeded: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const startPct = Math.round((i / files.length) * 75);
      prog(startPct, files.length > 1 ? `Uploading ${i + 1}/${files.length}: ${file.name}` : `Uploading ${file.name}...`);
      try {
        const url = `/api/upload?project=${encodeURIComponent(projectName)}&path=${encodeURIComponent(file.name)}`;
        const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file });
        if (!res.ok) throw new Error(res.status === 413 ? `${file.name} too large` : `Failed: ${file.name}`);
        succeeded.push(file.name);
      } catch (err: any) {
        failed.push(file.name);
        prog(startPct, `Error: ${err.message}`);
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    if (succeeded.length === 0) {
      prog(100, failed.length === 1 ? `Failed to import ${failed[0]}` : `Failed to import ${failed.length} files`);
      done();
      return;
    }
    prog(85, "Reloading project...");
    await handleSelectProject(projectName);
    const msg = succeeded.length === 1 ? `Imported ${succeeded[0]}` : `Imported ${succeeded.length} files`;
    prog(100, failed.length > 0 ? `${msg} (${failed.length} failed)` : msg);
    done();
  }

  async function importZipToProject(file: File, targetProject: string, isNew: boolean) {
    const prog = (pct: number, msg: string) => setLocalProgress({ active: true, progress: pct, status: msg, type: "import" });
    const done = () => setTimeout(() => setLocalProgress({ active: false, progress: 0, status: "", type: "" }), 1200);
    prog(5, `Uploading ${(file.size / 1024 / 1024).toFixed(1)}MB...`);
    try {
      const folderName = isNew ? "" : file.name.replace(/\.zip$/i, "").replace(/[^a-zA-Z0-9_.-]/g, "_");
      const url = isNew
        ? `/api/projects/import?name=${encodeURIComponent(targetProject)}`
        : `/api/projects/import?into=${encodeURIComponent(targetProject)}&folder=${encodeURIComponent(folderName)}`;
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", url);
        xhr.setRequestHeader("Content-Type", "application/zip");
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const pct = Math.round(5 + (e.loaded / e.total) * 75);
            prog(pct, `Uploading ${Math.round((e.loaded / e.total) * 100)}%...`);
          }
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else { try { reject(new Error(JSON.parse(xhr.responseText).error || `HTTP ${xhr.status}`)); } catch { reject(new Error(`HTTP ${xhr.status}`)); } }
        };
        xhr.onerror = () => reject(new Error("Network error"));
        xhr.send(file);
      });
      prog(92, "Loading project...");
      const projRes = await fetch("/api/projects");
      const projData = await projRes.json();
      useIDEStore.getState().setAvailableProjects(projData.projects);
      await handleSelectProject(targetProject);
      prog(100, "Done!");
      done();
    } catch (err: any) {
      setLocalProgress({ active: true, progress: 100, status: `Error: ${err.message}`, type: "import" });
      setTimeout(() => setLocalProgress({ active: false, progress: 0, status: "", type: "" }), 3000);
    }
  }

  async function handleDownloadProject() {
    if (!projectName || transfer.active) return;
    const prog = (pct: number, msg: string) => setLocalProgress({ active: true, progress: pct, status: msg, type: "download" });
    prog(5, "Reading file tree...");
    try {
      const treeRes = await fetch(`/api/files?project=${encodeURIComponent(projectName)}`);
      const treeData = await treeRes.json();
      if (!treeRes.ok) throw new Error(treeData.error || "Failed to read project");
      const tree = treeData.tree || {};
      const filePaths: string[] = [];
      for (const [id, node] of Object.entries(tree) as [string, any][]) {
        if (node.type === "file" && id !== ".") filePaths.push(id);
      }
      if (filePaths.length === 0) throw new Error("Project has no files");
      prog(10, `Downloading ${filePaths.length} files...`);
      const zip = new JSZip();
      const BATCH = 6;
      let fetched = 0;
      for (let i = 0; i < filePaths.length; i += BATCH) {
        const batch = filePaths.slice(i, i + BATCH);
        const results = await Promise.all(batch.map(async (filePath) => {
          try {
            const res = await fetch(`/api/files/content?project=${encodeURIComponent(projectName)}&file=${encodeURIComponent(filePath)}`);
            const data = await res.json();
            return { path: filePath, content: data.content ?? "" };
          } catch { return { path: filePath, content: "" }; }
        }));
        for (const { path, content } of results) zip.file(path, content);
        fetched += batch.length;
        prog(Math.round(10 + (fetched / filePaths.length) * 70), `${fetched}/${filePaths.length} files...`);
      }
      prog(85, "Generating ZIP...");
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${projectName}.zip`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      prog(100, "Downloaded!");
      setTimeout(() => setLocalProgress({ active: false, progress: 0, status: "", type: "" }), 1500);
    } catch (err: any) {
      setLocalProgress({ active: true, progress: 100, status: `Error: ${err.message}`, type: "download" });
      setTimeout(() => setLocalProgress({ active: false, progress: 0, status: "", type: "" }), 4000);
    }
  }

  const navItems: { v: typeof currentView; icon: any; label: string }[] = [
    { v: "code", icon: Code2, label: "Code" },
    { v: "preview", icon: Monitor, label: "Preview" },
    { v: "terminals", icon: LayoutGrid, label: "Terminals" },
    { v: "chats", icon: MessageSquare, label: "Chats" },
    { v: "settings", icon: Settings, label: "Settings" },
  ];

  return (
    <>
      <div className="h-10 border-b flex items-center px-4 relative shrink-0 z-20 gap-3" style={{ background: "#0a0a0a", borderColor: "rgba(245,245,245,0.06)" }}>
        {/* WORKSPACE eyebrow */}
        <span className="font-mono text-[9px] uppercase tracking-[0.32em] select-none" style={{ color: "rgba(245,245,245,0.5)", fontWeight: 600 }}>
          WORKSPACE
        </span>

        {/* Project pill */}
        <div className="relative">
          <button
            onClick={() => {
              const opening = !showSelect;
              setShowSelect(opening);
              if (opening) {
                fetch("/api/projects").then((r) => r.json()).then((d) => {
                  if (d.projects) useIDEStore.getState().setAvailableProjects(d.projects);
                }).catch(() => {});
              }
            }}
            className="flex items-center gap-1.5 h-6 px-2 hover:bg-ide-hover transition-colors"
          >
            <span
              className="truncate max-w-[200px] font-mono text-[10px] uppercase tracking-[0.2em]"
              style={{ color: "#ffffff", fontWeight: 700 }}
            >
              {projectName || "select project"}
            </span>
            <span className="font-mono text-[9px]" style={{ color: "rgba(255,255,255,0.5)" }}>▾</span>
          </button>
          {showSelect && (
            <div className="absolute top-full left-0 mt-1 min-w-[240px] max-w-[360px] bg-ide-elevated border border-ide-border-strong rounded-md z-50 max-h-72 overflow-auto shadow-card animate-scale-in origin-top-left">
              <div className="px-2.5 py-1.5 border-b border-ide-border">
                <span className="text-[10px] uppercase tracking-wider text-ide-muted">Projects</span>
              </div>
              {availableProjects.map((p) => (
                <div
                  key={p}
                  className={`group flex items-center transition-colors ${
                    p === projectName ? "bg-ide-active" : "hover:bg-ide-hover"
                  }`}
                >
                  <button
                    onClick={() => handleSelectProject(p)}
                    className="flex-1 text-left px-2.5 py-1.5 text-[12px] truncate flex items-center gap-2 min-w-0"
                    title={p}
                  >
                    <span className={`w-1 h-1 rounded-full shrink-0 ${p === projectName ? "bg-accent" : "bg-transparent"}`} />
                    <span className={p === projectName ? "text-ide-text" : "text-ide-text-soft"}>{p}</span>
                  </button>
                  <button
                    onClick={(e) => handleDeleteProject(p, e)}
                    disabled={deletingProject !== null}
                    className={`p-2 opacity-0 group-hover:opacity-100 ${deletingProject === p ? "text-severity-error animate-pulse opacity-100" : "text-ide-muted hover:text-severity-error"}`}
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
              {availableProjects.length === 0 && (
                <div className="px-3 py-3 text-[12px] text-ide-muted text-center">No projects yet</div>
              )}
            </div>
          )}
        </div>

        {isCreating ? (
          <div className="flex items-center gap-1 bg-ide-elevated border border-accent/40 rounded h-6 pl-1.5 pr-0.5">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateProject();
                if (e.key === "Escape") { setIsCreating(false); setNewName(""); }
              }}
              placeholder="project name"
              className="h-full w-32 px-0.5 text-[12px] text-ide-text bg-transparent outline-none placeholder:text-ide-faint"
              autoFocus
            />
            <button onClick={handleCreateProject} className="btn-icon !w-5 !h-5 !text-severity-ok">
              <Check size={11} />
            </button>
            <button onClick={() => { setIsCreating(false); setNewName(""); }} className="btn-icon !w-5 !h-5">
              <X size={11} />
            </button>
          </div>
        ) : (
          <button onClick={() => setIsCreating(true)} className="btn-icon" title="New project">
            <FolderPlus size={12} />
          </button>
        )}

        <input ref={fileInputRef} type="file" onChange={handleFileSelect} className="hidden" multiple />
        <button onClick={() => fileInputRef.current?.click()} disabled={transfer.active} className="btn-icon disabled:opacity-40" title="Import">
          <Upload size={12} />
        </button>
        <button onClick={handleDownloadProject} disabled={transfer.active || !projectName} className={`btn-icon disabled:opacity-40 ${downloading ? "animate-pulse" : ""}`} title="Download">
          <Download size={12} />
        </button>

        {/* Center nav — mono caps, white active */}
        <div className="absolute left-1/2 -translate-x-1/2">
          <div className="flex items-center gap-5">
            {navItems.map(({ v, label }) => {
              const active = currentView === v;
              return (
                <button
                  key={v}
                  onClick={() => setCurrentView(v)}
                  className="font-mono text-[10px] uppercase tracking-[0.32em] transition-colors h-6 flex items-center"
                  style={{
                    color: active ? "#ffffff" : "rgba(245,245,245,0.4)",
                    fontWeight: active ? 700 : 500,
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="ml-auto" />

        {showSelect && (
          <div className="fixed inset-0 z-40" onClick={() => setShowSelect(false)} />
        )}
      </div>

      {/* Transfer progress strip */}
      {transfer.active && (
        <div className="h-6 bg-ide-panel border-b border-ide-border flex items-center px-3 gap-3 shrink-0">
          <span className={`text-[10px] font-mono shrink-0 ${
            transfer.type === "download" ? "text-accent" : "text-severity-info"
          }`}>
            {transfer.type === "download" ? "↓" : "↑"}
          </span>
          <div className="flex-1 h-px bg-ide-border overflow-hidden">
            <div
              className={`h-full transition-all duration-500 ${
                transfer.status.startsWith("Error") ? "bg-severity-error"
                  : transfer.progress >= 100 ? "bg-severity-ok"
                  : "bg-accent"
              }`}
              style={{ width: `${transfer.progress}%` }}
            />
          </div>
          <span className={`text-[10.5px] whitespace-nowrap ${
            transfer.status.startsWith("Error") ? "text-severity-error"
              : transfer.progress >= 100 ? "text-severity-ok"
              : "text-ide-muted"
          }`}>
            {transfer.status}
          </span>
        </div>
      )}

      {/* ZIP modal */}
      {zipModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in" onClick={() => setZipModal(null)}>
          <div className="bg-ide-elevated border border-ide-border-strong w-[420px] rounded-lg shadow-modal animate-scale-in" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-ide-border">
              <span className="text-[13px] font-medium text-ide-text">Import ZIP</span>
              <button onClick={() => setZipModal(null)} className="btn-icon"><X size={12} /></button>
            </div>
            <div className="px-4 py-3 flex flex-col gap-2">
              <p className="text-[12px] text-ide-muted mb-1">
                <span className="text-ide-text">{zipModal.file.name}</span> — choose destination
              </p>
              {projectName && (
                <button
                  onClick={() => { const file = zipModal.file; setZipModal(null); importZipToProject(file, projectName, false); }}
                  className="flex items-center gap-3 w-full px-3 py-2.5 text-[12.5px] text-ide-text bg-ide-surface border border-ide-border rounded-md hover:border-accent/40 transition-all text-left"
                >
                  <Upload size={13} className="text-severity-info shrink-0" />
                  <div className="min-w-0">
                    <div>Import into current project</div>
                    <div className="text-[11px] text-ide-muted truncate">→ {projectName}</div>
                  </div>
                </button>
              )}
              <button
                onClick={() => { const file = zipModal.file; const name = zipModal.name; setZipModal(null); importZipToProject(file, name, true); }}
                className="flex items-center gap-3 w-full px-3 py-2.5 text-[12.5px] text-ide-text bg-ide-surface border border-ide-border rounded-md hover:border-accent/40 transition-all text-left"
              >
                <FolderPlus size={13} className="text-severity-ok shrink-0" />
                <div className="min-w-0">
                  <div>Create new project</div>
                  <div className="text-[11px] text-ide-muted truncate">→ {zipModal.name}</div>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
