"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useIDEStore } from "@/store/useIDEStore";
import { isImageFile } from "@/lib/utils";
import TopBar from "@/components/TopBar";
import FileExplorer from "@/components/FileExplorer";
import CodeEditor from "@/components/CodeEditor";
import ChatPanel from "@/components/ChatPanel";
import Preview from "@/components/Preview";
import SettingsPage from "@/components/SettingsPage";
import TerminalsContent from "@/components/TerminalsContent";
import MultiChatsContent from "@/components/MultiChatsContent";
import { Code } from "lucide-react";

const EXPLORER_MIN = 140;
const EXPLORER_MAX = 500;
const TERMINAL_MIN = 180;
const TERMINAL_MAX = 700;

/**
 * Preload content for every file in the tree that isn't already cached.
 * This gives us a "before AI changes" baseline so content polling can diff
 * any file — not just files currently open in a tab.
 * Runs in background: batched, yields between batches, skips huge files.
 */
async function preloadAllContents(
  project: string,
  tree: Record<string, { type: string; id: string }>,
  signal: AbortSignal
) {
  const ids = Object.values(tree)
    .filter((n) => n.type === "file" && !isImageFile(n.id))
    .map((n) => n.id);

  const BATCH = 5;
  for (let i = 0; i < ids.length; i += BATCH) {
    if (signal.aborted) return;
    const batch = ids.slice(i, i + BATCH);
    await Promise.all(
      batch.map(async (fileId) => {
        if (signal.aborted) return;
        const s = useIDEStore.getState();
        if (fileId in s.fileContents) return; // already cached
        if (fileId in s.pendingChanges) return; // pending creation — baseline must stay ""
        try {
          const r = await fetch(
            `/api/files/content?project=${encodeURIComponent(project)}&file=${encodeURIComponent(fileId)}`
          );
          const d = await r.json();
          if (typeof d.content !== "string") return;
          if (d.content.length > 300_000) return; // skip minified / generated files
          useIDEStore.setState((curr) => {
            // Abort if the user switched projects while we were fetching
            if (curr.projectName !== project) return {};
            if (fileId in curr.fileContents) return {};
            if (fileId in curr.pendingChanges) return {}; // re-check after await
            return { fileContents: { ...curr.fileContents, [fileId]: d.content } };
          });
        } catch {}
      })
    );
    // Yield between batches so we don't block the server
    await new Promise((r) => setTimeout(r, 80));
  }
}

export default function HomePage() {
  const router = useRouter();
  const { isAuthenticated, setAvailableProjects, projectName, setProjectName, currentView } =
    useIDEStore();

  const [explorerWidth, setExplorerWidth] = useState(260);
  const [terminalWidth, setTerminalWidth] = useState(340);
  const [showCode, setShowCode] = useState(true);

  // Track which views have been visited (lazy-mount, then keep alive)
  const [mountedViews, setMountedViews] = useState<Set<string>>(new Set(["code"]));
  useEffect(() => {
    setMountedViews((prev) => {
      if (prev.has(currentView)) return prev;
      return new Set(prev).add(currentView);
    });
  }, [currentView]);

  // Drag state refs (no re-render during drag)
  const dragTypeRef = useRef<"explorer" | "terminal" | null>(null);
  const dragStartXRef = useRef(0);
  const dragStartWidthRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!dragTypeRef.current) return;
    const dx = e.clientX - dragStartXRef.current;

    if (dragTypeRef.current === "explorer") {
      const next = Math.max(EXPLORER_MIN, Math.min(EXPLORER_MAX, dragStartWidthRef.current + dx));
      setExplorerWidth(next);
    } else {
      const next = Math.max(TERMINAL_MIN, Math.min(TERMINAL_MAX, dragStartWidthRef.current - dx));
      setTerminalWidth(next);
    }
  }, []);

  const onMouseUp = useCallback(() => {
    dragTypeRef.current = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  useEffect(() => {
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [onMouseMove, onMouseUp]);

  function startDrag(type: "explorer" | "terminal", e: React.MouseEvent) {
    e.preventDefault();
    dragTypeRef.current = type;
    dragStartXRef.current = e.clientX;
    dragStartWidthRef.current = type === "explorer" ? explorerWidth : terminalWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  // On mount: check if we have a valid server-side session
  useEffect(() => {
    if (!isAuthenticated) {
      fetch("/api/auth/check").then((r) => {
        if (r.ok) {
          useIDEStore.getState().setAuthenticated(true);
        } else {
          router.push("/login");
        }
      }).catch(() => router.push("/login"));
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;

    const ac = new AbortController();

    async function loadProjects() {
      const res = await fetch("/api/projects");
      const data = await res.json();
      setAvailableProjects(data.projects);

      if (data.projects.length > 0) {
        const store = useIDEStore.getState();
        // Use persisted project if it still exists, else fall back to first
        const target = store.projectName && data.projects.includes(store.projectName)
          ? store.projectName
          : data.projects[0];
        // Only load if file tree isn't populated yet (fresh page load)
        if (Object.keys(store.fileTree).length === 0) {
          if (target !== store.projectName) setProjectName(target);
          // Load tree + ALL file contents in one request — establishes baseline
          // for change detection before any AI can modify files
          const filesRes = await fetch(
            `/api/files?project=${encodeURIComponent(target)}&contents=1`
          );
          const filesData = await filesRes.json();
          useIDEStore.getState().loadProject(
            filesData.tree, filesData.contents, filesData.rootFiles, filesData.folderOpen
          );
        }
      }
    }

    loadProjects();
    return () => ac.abort();
  }, [isAuthenticated]);

  // Poll file tree structure for new/deleted files (explorer auto-refresh)
  useEffect(() => {
    if (!isAuthenticated || !projectName) return;

    let lastFingerprint = "";
    let preloadAc: AbortController | null = null;

    const timer = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/files/fingerprint?project=${encodeURIComponent(projectName)}`
        );
        const data = await res.json();
        if (!data.fingerprint) return;

        if (lastFingerprint && data.fingerprint !== lastFingerprint) {
          const filesRes = await fetch(
            `/api/files?project=${encodeURIComponent(projectName)}`
          );
          const filesData = await filesRes.json();

          const current = useIDEStore.getState();
          const mergedFolderOpen = {
            ...(filesData.folderOpen || {}),
            ...current.folderOpen,
          };
          const newTree = filesData.tree || {};
          const newTreeIds = new Set(Object.keys(newTree));

          // Detect newly created files: in new tree but not in old tree
          const oldTreeIds = new Set(Object.keys(current.fileTree));
          const addedFileIds = Object.entries(newTree)
            .filter(([id, node]: [string, any]) => node.type === "file" && !oldTreeIds.has(id) && !isImageFile(id))
            .map(([id]) => id);

          // Detect deleted files: in fileContents but not in new tree
          const staleIds = Object.keys(current.fileContents).filter(
            (fid) => !newTreeIds.has(fid)
          );

          useIDEStore.setState({
            fileTree: newTree,
            rootFiles: filesData.rootFiles || [],
            folderOpen: mergedFolderOpen,
          });

          // New files → pending creation (baseline stays "", diff shows all-added)
          for (const fid of addedFileIds) {
            fetch(
              `/api/files/content?project=${encodeURIComponent(projectName)}&file=${encodeURIComponent(fid)}`
            )
              .then((r) => r.json())
              .then((d) => {
                if (typeof d.content !== "string") return;
                useIDEStore.setState((s) => {
                  if (s.projectName !== projectName) return {};
                  if (fid in s.pendingChanges || fid in s.fileContents) return {};
                  return {
                    pendingChanges: { ...s.pendingChanges, [fid]: d.content },
                    openFiles: s.openFiles.includes(fid) ? s.openFiles : [...s.openFiles, fid],
                  };
                });
              })
              .catch(() => {});
          }

          // Deleted files → pending deletion (keep fileContents as diff baseline)
          if (staleIds.length > 0) {
            useIDEStore.setState((s) => {
              const newPendingChanges = { ...s.pendingChanges };
              const newOpenFiles = [...s.openFiles];
              for (const fid of staleIds) {
                if (!(fid in s.pendingChanges)) {
                  newPendingChanges[fid] = "";
                  if (!newOpenFiles.includes(fid)) newOpenFiles.push(fid);
                }
              }
              return { pendingChanges: newPendingChanges, openFiles: newOpenFiles };
            });
          }

          preloadAc?.abort();
          preloadAc = new AbortController();
          preloadAllContents(projectName, newTree, preloadAc.signal);
        }

        lastFingerprint = data.fingerprint;
      } catch {}
    }, 3000);

    return () => {
      clearInterval(timer);
      preloadAc?.abort();
    };
  }, [isAuthenticated, projectName]);

  // Poll ALL cached files for external changes every 3 seconds
  useEffect(() => {
    if (!isAuthenticated || !projectName) return;

    const timer = setInterval(async () => {
      const store = useIDEStore.getState();
      const cachedIds = Object.keys(store.fileContents);

      const filesToCheck = cachedIds.filter((fid) => {
        if (isImageFile(fid)) return false;
        if (!(fid in store.fileTree)) return false;
        const lastEdit = store.lastUserEdit[fid] || 0;
        return Date.now() - lastEdit > 3000;
      });
      if (filesToCheck.length === 0) return;

      for (const fileId of filesToCheck) {
        // Abort entire loop if the project changed while we were awaiting.
        // Without this guard, stale callbacks would compare old-project files
        // against the new project's (empty) fileContents, creating false positives.
        if (useIDEStore.getState().projectName !== projectName) break;

        try {
          const res = await fetch(
            `/api/files/content?project=${encodeURIComponent(projectName)}&file=${encodeURIComponent(fileId)}`
          );
          const d = await res.json();

          // Re-check after the await — project may have changed during the fetch
          if (useIDEStore.getState().projectName !== projectName) break;

          if (d.tooLarge) continue;
          const diskContent = d.content ?? "";
          const freshStore = useIDEStore.getState();
          const editorContent = freshStore.fileContents[fileId] ?? "";
          // Skip diff for large content — would freeze the browser
          if (diskContent.length >= 128 * 1024 || editorContent.length >= 128 * 1024) continue;
          const differs = diskContent !== editorContent;
          const currentPending = freshStore.pendingChanges[fileId];
          // Update pending if disk changed from editor baseline, OR if the
          // disk has advanced beyond a previously-captured intermediate snapshot
          // (e.g. AI makes two separate edits and poll caught the first mid-run).
          const shouldUpdate = differs && (
            currentPending === undefined || diskContent !== currentPending
          );

          if (shouldUpdate) {
            useIDEStore.getState().setPendingChange(fileId, diskContent);
            if (!freshStore.openFiles.includes(fileId)) {
              useIDEStore.setState((s) => ({
                openFiles: [...s.openFiles, fileId],
              }));
            }
          }
        } catch {}
      }
    }, 3000);

    return () => clearInterval(timer);
  }, [isAuthenticated, projectName]);

  if (!isAuthenticated) return null;

  return (
    <div className="w-screen h-screen bg-ide-bg flex flex-col overflow-hidden">
      <TopBar />

      {/* Code view */}
      <div
        ref={containerRef}
        className="flex flex-1 min-h-0 overflow-hidden"
        style={{ display: currentView === "code" ? "flex" : "none" }}
      >
        {showCode && (
          <>
            <FileExplorer width={explorerWidth} />
            <div
              onMouseDown={(e) => startDrag("explorer", e)}
              className="group w-px shrink-0 cursor-col-resize bg-ide-border hover:bg-accent active:bg-accent-hover transition-colors z-10 relative"
              title="Drag to resize"
            >
              <div className="absolute inset-y-0 -left-1 -right-1 group-hover:bg-accent/10 transition-colors" />
            </div>
            <CodeEditor />
            <div
              onMouseDown={(e) => startDrag("terminal", e)}
              className="group w-px shrink-0 cursor-col-resize bg-ide-border hover:bg-accent active:bg-accent-hover transition-colors z-10 relative"
              title="Drag to resize"
            >
              <div className="absolute inset-y-0 -left-1 -right-1 group-hover:bg-accent/10 transition-colors" />
            </div>
          </>
        )}
        {!showCode && (
          <button
            onClick={() => setShowCode(true)}
            className="w-9 shrink-0 flex items-center justify-center bg-ide-panel border-r border-ide-border text-ide-muted hover:text-accent hover:bg-accent-glow transition-colors"
            title="Show code editor"
          >
            <Code size={14} />
          </button>
        )}
        <ChatPanel width={showCode ? terminalWidth : undefined} onToggleCode={() => setShowCode(!showCode)} />
      </div>

      {/* Preview view */}
      {mountedViews.has("preview") && (
        <div
          className="flex flex-1 min-h-0 overflow-hidden"
          style={{ display: currentView === "preview" ? "flex" : "none" }}
        >
          <FileExplorer />
          <Preview />
        </div>
      )}

      {/* Settings view */}
      {mountedViews.has("settings") && (
        <div
          className="flex flex-1 min-h-0 overflow-hidden"
          style={{ display: currentView === "settings" ? "flex" : "none" }}
        >
          <SettingsPage />
        </div>
      )}

      {/* Terminals view */}
      {mountedViews.has("terminals") && (
        <div
          className="flex flex-1 min-h-0 overflow-hidden"
          style={{ display: currentView === "terminals" ? "flex" : "none" }}
        >
          <TerminalsContent />
        </div>
      )}

      {mountedViews.has("chats") && (
        <div
          className="flex flex-1 min-h-0 overflow-hidden"
          style={{ display: currentView === "chats" ? "flex" : "none" }}
        >
          <MultiChatsContent />
        </div>
      )}
    </div>
  );
}
