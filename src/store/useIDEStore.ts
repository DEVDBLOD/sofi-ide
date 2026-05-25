import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { detectLanguage } from "@/lib/utils";

// Storage wrapper that handles QuotaExceededError by pruning oldest
// conversations until the payload fits. Without this, hitting the localStorage
// limit (~5–10 MB) crashes the app since every state change triggers setItem.
const safeStorage = createJSONStorage(() => ({
  getItem: (name: string) => (typeof window === "undefined" ? null : window.localStorage.getItem(name)),
  removeItem: (name: string) => { if (typeof window !== "undefined") window.localStorage.removeItem(name); },
  setItem: (name: string, value: string) => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(name, value);
    } catch (e: any) {
      if (e?.name !== "QuotaExceededError") throw e;
      // Try progressively dropping conversations until it fits, oldest first.
      try {
        const parsed = JSON.parse(value);
        const convs = parsed?.state?.conversations;
        if (Array.isArray(convs) && convs.length > 0) {
          const sorted = [...convs].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
          while (sorted.length > 0) {
            sorted.shift();
            parsed.state.conversations = sorted;
            const next = JSON.stringify(parsed);
            try { window.localStorage.setItem(name, next); return; } catch {}
          }
        }
      } catch {}
      // Last resort: wipe the persisted blob so the app can keep running.
      try { window.localStorage.removeItem(name); } catch {}
    }
  },
}));

export interface FileNode {
  id: string;
  name: string;
  type: "file" | "folder";
  path?: string;
  language?: string;
  children?: string[];
  isOpen?: boolean;
}

export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
  ts?: number;          // unix ms when the tool event was received
  id?: string;          // tool_use_id, used to match the tool_result
  result?: string;      // text output returned by the tool
  isError?: boolean;    // whether the tool returned an error
  doneTs?: number;      // unix ms when the result arrived
}

export interface ToolPermissionDenial {
  tool_name: string;
  tool_use_id: string;
  tool_input: Record<string, unknown>;
}

export interface UserQuestionOption {
  label: string;
  description?: string;
}

export interface UserQuestion {
  question: string;
  header?: string;
  options: UserQuestionOption[];
  multiSelect?: boolean;
}

// Ordered chunks that make up an assistant message body. We render these in
// the order they arrived from Claude so text and tool calls interleave
// correctly instead of all tools bunching above all text.
export type MessageSegment =
  | { type: "text"; text: string }
  | { type: "tool"; tool: ToolCall };

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  // Ordered text/tool segments. When present, the UI renders these instead of
  // the flat content + toolCalls split. content is still maintained as the
  // concatenated text for fallback and for code that reads the final reply.
  segments?: MessageSegment[];
  thinking?: string;
  toolCalls?: ToolCall[];
  hidden?: boolean;
  fromEditMode?: boolean;
  isPermissionRetry?: boolean;
  permissionDenials?: ToolPermissionDenial[];
  userQuestions?: UserQuestion[];
  // Snapshot of fileContents at the moment this user message was sent — enables
  // "revert to here" so the user can roll back AI changes from this turn.
  snapshot?: Record<string, string>;
  // List of file paths that existed at snapshot time — used to delete files
  // the AI created after this message during a revert.
  snapshotFiles?: string[];
  // Tracks whether this checkpoint has already been used (visual hint)
  reverted?: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  sessionId?: string;
  // Project this conversation belongs to. Empty string = legacy/unscoped.
  // Filters the conversation list per project so different projects don't
  // mix chats and so AI work can run in parallel across projects.
  projectName?: string;
}

interface IDEState {
  // Auth
  isAuthenticated: boolean;
  setAuthenticated: (v: boolean) => void;

  // Projects
  availableProjects: string[];
  projectName: string;
  setAvailableProjects: (p: string[]) => void;
  setProjectName: (name: string) => void;

  // File tree
  fileTree: Record<string, FileNode>;
  fileContents: Record<string, string>;
  rootFiles: string[];
  folderOpen: Record<string, boolean>;
  setFileTree: (tree: Record<string, FileNode>) => void;
  setFileContents: (contents: Record<string, string>) => void;
  setRootFiles: (files: string[]) => void;
  setFolderOpen: (open: Record<string, boolean>) => void;
  toggleFolder: (folderId: string) => void;

  // Editor
  activeFile: string;
  openFiles: string[];
  openFile: (fileId: string) => void;
  closeFile: (fileId: string) => void;
  setActiveFile: (fileId: string) => void;
  updateFileContent: (fileId: string, content: string) => void;
  lastUserEdit: Record<string, number>;
  markUserEdit: (fileId: string) => void;

  // Pending changes (external edits detected automatically)
  pendingChanges: Record<string, string>;
  setPendingChange: (fileId: string, newContent: string) => void;
  acceptChange: (fileId: string) => void;
  discardChange: (fileId: string) => void;
  acceptAllChanges: () => void;
  discardAllChanges: () => void;

  // Terminal
  terminalHistory: string[];
  addTerminalHistory: (cmd: string) => void;

  // Code execution
  isRunning: boolean;
  setIsRunning: (v: boolean) => void;
  lintErrors: { line: number; message: string }[];
  setLintErrors: (errors: { line: number; message: string }[]) => void;

  // Per-file diagnostics (from lint)
  fileDiagnostics: Record<string, { errors: number; warnings: number }>;
  setFileDiagnostics: (fileId: string, d: { errors: number; warnings: number }) => void;
  clearFileDiagnostics: (fileId: string) => void;

  // Preview
  device: "desktop" | "tablet" | "mobile";
  zoom: number;
  previewUrl: string;
  setDevice: (d: "desktop" | "tablet" | "mobile") => void;
  setZoom: (z: number) => void;
  setPreviewUrl: (url: string) => void;

  // AI
  aiInput: string;
  aiModel: string;
  aiEffort: string;
  // Per-conversation loading state. Multiple conversations (typically tied to
  // different projects) can be running in parallel. The UI checks
  // loadingConvIds.includes(convId) instead of a single global flag.
  loadingConvIds: string[];
  setAiInput: (v: string) => void;
  setAiModel: (v: string) => void;
  setAiEffort: (v: string) => void;
  setConvLoading: (convId: string, loading: boolean) => void;
  isConvLoading: (convId: string) => boolean;

  // After the user clicks "Permitir" once in a conversation, that convId is
  // trusted — subsequent runs use bypassPermissions so popups stop appearing.
  trustedConvIds: string[];
  trustConversation: (id: string) => void;
  untrustConversation: (id: string) => void;

  // Conversations
  conversations: Conversation[];
  // Active conversation per project. Different projects keep their own
  // "current chat" so switching projects doesn't drop you onto an unrelated
  // chat from another project.
  activeConvByProject: Record<string, string>;
  activeConversationId: string; // derived: activeConvByProject[projectName]
  newConversation: () => string;
  newConversationForProject: (project: string) => string;
  ensureConvForProject: (project: string) => string;
  switchConversation: (id: string) => void;
  deleteConversation: (id: string) => void;
  addMessageToConversation: (id: string, msg: ChatMessage) => void;
  updateLastMessageInConversation: (id: string, content: string) => void;
  appendTextSegmentToLastMessage: (id: string, chunk: string) => void;
  appendThinkingToLastMessage: (id: string, chunk: string) => void;
  addToolCallToLastMessage: (id: string, tool: ToolCall) => void;
  setToolResultOnLastMessage: (id: string, toolUseId: string, result: string, isError: boolean) => void;
  setPermissionDenialsOnLastMessage: (id: string, denials: ToolPermissionDenial[]) => void;
  setUserQuestionsOnLastMessage: (id: string, questions: UserQuestion[]) => void;
  removeLastAssistantMessage: (id: string) => void;
  setConversationTitle: (id: string, title: string) => void;
  setConversationSessionId: (id: string, sessionId: string) => void;

  // API Keys
  apiKeys: { name: string; key: string }[];
  selectedApiKeyName: string;
  addApiKey: (name: string, key: string) => void;
  removeApiKey: (name: string) => void;
  selectApiKey: (name: string) => void;

  // Navigation
  currentView: "code" | "preview" | "settings" | "terminals" | "chats";
  setCurrentView: (v: "code" | "preview" | "settings" | "terminals" | "chats") => void;

  // Explorer
  explorerBusy: boolean;
  setExplorerBusy: (v: boolean) => void;
  isRefreshing: boolean;
  setIsRefreshing: (v: boolean) => void;

  // Transfer (import/download progress)
  transferActive: boolean;
  transferProgress: number;
  transferStatus: string;
  transferType: "import" | "download" | "";
  setTransfer: (active: boolean, progress: number, status: string, type: "import" | "download" | "") => void;

  // Loading full project
  loadProject: (
    tree: Record<string, FileNode>,
    contents: Record<string, string>,
    rootFiles: string[],
    folderOpen: Record<string, boolean>
  ) => void;
}

function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

function makeConversation(projectName?: string): Conversation {
  return {
    id: generateId(),
    title: "New chat",
    messages: [],
    createdAt: Date.now(),
    projectName: projectName ?? "",
  };
}

const initialConv = makeConversation();

export const useIDEStore = create<IDEState>()(
  persist(
    (set, get) => ({
  // Auth
  isAuthenticated: false,
  setAuthenticated: (v) => set({ isAuthenticated: v }),

  // Projects
  availableProjects: [],
  projectName: "",
  setAvailableProjects: (p) => set({ availableProjects: p }),
  setProjectName: (name) =>
    set((s) => {
      // When switching projects, surface that project's last active conversation.
      // If the project has none yet, create a fresh one so the chat panel is
      // never empty for an open project.
      let activeConvByProject = s.activeConvByProject;
      let conversations = s.conversations;
      let convId = activeConvByProject[name];
      if (!convId || !conversations.find((c) => c.id === convId)) {
        const candidates = conversations
          .filter((c) => (c.projectName ?? "") === name)
          .sort((a, b) => b.createdAt - a.createdAt);
        if (candidates.length > 0) {
          convId = candidates[0].id;
        } else {
          const fresh = makeConversation(name);
          conversations = [...conversations, fresh];
          convId = fresh.id;
        }
        activeConvByProject = { ...activeConvByProject, [name]: convId };
      }
      return {
        projectName: name,
        conversations,
        activeConvByProject,
        activeConversationId: convId,
      };
    }),

  // File tree
  fileTree: {},
  fileContents: {},
  rootFiles: [],
  folderOpen: {},
  setFileTree: (tree) => set({ fileTree: tree }),
  setFileContents: (contents) => set({ fileContents: contents }),
  setRootFiles: (files) => set({ rootFiles: files }),
  setFolderOpen: (open) => set({ folderOpen: open }),
  toggleFolder: (folderId) =>
    set((s) => ({
      folderOpen: {
        ...s.folderOpen,
        [folderId]: !s.folderOpen[folderId],
      },
    })),

  // Editor
  activeFile: "",
  openFiles: [],
  openFile: (fileId) => {
    const s = get();
    const isPending = fileId in s.pendingChanges;
    if (!isPending) {
      const node = s.fileTree[fileId];
      if (!node || node.type !== "file") return;
    }
    const openFiles = s.openFiles.includes(fileId)
      ? s.openFiles
      : [...s.openFiles, fileId];
    set({ activeFile: fileId, openFiles });

    // Don't fetch content for pending files — baseline must stay as-is for diff
    if (!(fileId in s.fileContents) && !isPending) {
      const project = s.projectName;
      if (project) {
        fetch(`/api/files/content?project=${encodeURIComponent(project)}&file=${encodeURIComponent(fileId)}`)
          .then((r) => r.json())
          .then((data) => {
            const content = data.tooLarge
              ? `// This file is too large to display in the editor (${(data.size / 1024 / 1024).toFixed(1)} MB).\n// You can still use it via the terminal or Claude chat.`
              : (data.content ?? "");
            set((curr) => ({
              fileContents: { ...curr.fileContents, [fileId]: content },
            }));
          })
          .catch(() => {
            set((curr) => ({
              fileContents: { ...curr.fileContents, [fileId]: "" },
            }));
          });
      }
    }
  },
  closeFile: (fileId) =>
    set((s) => {
      const openFiles = s.openFiles.filter((f) => f !== fileId);
      const activeFile =
        s.activeFile === fileId
          ? openFiles[openFiles.length - 1] || ""
          : s.activeFile;
      return { openFiles, activeFile };
    }),
  setActiveFile: (fileId) => set({ activeFile: fileId }),
  updateFileContent: (fileId, content) =>
    set((s) => ({
      fileContents: { ...s.fileContents, [fileId]: content },
    })),
  lastUserEdit: {},
  markUserEdit: (fileId) =>
    set((s) => ({ lastUserEdit: { ...s.lastUserEdit, [fileId]: Date.now() } })),

  // Pending changes
  pendingChanges: {},
  setPendingChange: (fileId, newContent) =>
    set((s) => ({
      pendingChanges: { ...s.pendingChanges, [fileId]: newContent },
    })),
  acceptChange: (fileId) => {
    const s = get();
    if (!(fileId in s.pendingChanges)) return;
    const newContent = s.pendingChanges[fileId];
    const next = { ...s.pendingChanges };
    delete next[fileId];
    const remaining = Object.keys(next);

    // Deletion: file was removed from disk (not in fileTree), keep baseline in fileContents for diff
    const isDeletion = fileId in s.fileContents && !(fileId in s.fileTree);
    if (isDeletion) {
      const fc = { ...s.fileContents };
      delete fc[fileId];
      const openFiles = s.openFiles.filter((f) => f !== fileId);
      let activeFile = s.activeFile === fileId
        ? (remaining.length > 0 ? remaining[0] : openFiles[openFiles.length - 1] || "")
        : s.activeFile;
      const finalOpen = remaining.length > 0 && !openFiles.includes(remaining[0])
        ? [...openFiles, remaining[0]]
        : openFiles;
      set({ fileContents: fc, pendingChanges: next, openFiles: finalOpen, activeFile });
      return;
    }

    // New file or edit: set fileContents to accepted content
    set({
      fileContents: { ...s.fileContents, [fileId]: newContent },
      pendingChanges: next,
    });
    if (remaining.length > 0) {
      set({ activeFile: remaining[0] });
      if (!s.openFiles.includes(remaining[0])) {
        set((curr) => ({ openFiles: [...curr.openFiles, remaining[0]] }));
      }
    }
  },
  discardChange: (fileId) => {
    const s = get();
    const next = { ...s.pendingChanges };
    delete next[fileId];
    const remaining = Object.keys(next);

    // New file (no baseline in fileContents): delete the file from disk
    const isNewFile = !(fileId in s.fileContents);
    if (isNewFile) {
      fetch("/api/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", project: s.projectName, filePath: fileId }),
      }).catch(() => {});
      const openFiles = s.openFiles.filter((f) => f !== fileId);
      const activeFile = s.activeFile === fileId
        ? (remaining.length > 0 ? remaining[0] : openFiles[openFiles.length - 1] || "")
        : s.activeFile;
      const finalOpen = remaining.length > 0 && !openFiles.includes(remaining[0])
        ? [...openFiles, remaining[0]]
        : openFiles;
      set({ pendingChanges: next, openFiles: finalOpen, activeFile });
      return;
    }

    // Edit or deletion restore: write fileContents baseline back to disk
    set({ pendingChanges: next });
    fetch("/api/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "write",
        project: s.projectName,
        filePath: fileId,
        content: s.fileContents[fileId] ?? "",
      }),
    }).catch(() => {});
    if (remaining.length > 0) {
      set({ activeFile: remaining[0] });
      if (!s.openFiles.includes(remaining[0])) {
        set((curr) => ({ openFiles: [...curr.openFiles, remaining[0]] }));
      }
    }
  },
  acceptAllChanges: () => {
    const s = get();
    const merged = { ...s.fileContents };
    const deletedIds: string[] = [];
    for (const [fileId, content] of Object.entries(s.pendingChanges)) {
      const isDeletion = fileId in s.fileContents && !(fileId in s.fileTree);
      if (isDeletion) {
        delete merged[fileId];
        deletedIds.push(fileId);
      } else {
        merged[fileId] = content;
      }
    }
    const openFiles = deletedIds.length > 0
      ? s.openFiles.filter((f) => !deletedIds.includes(f))
      : s.openFiles;
    const activeFile = deletedIds.includes(s.activeFile)
      ? (openFiles[openFiles.length - 1] || "")
      : s.activeFile;
    set({ fileContents: merged, pendingChanges: {}, openFiles, activeFile });
  },
  discardAllChanges: () => {
    const s = get();
    const newFileIds: string[] = [];
    for (const fileId of Object.keys(s.pendingChanges)) {
      const isNewFile = !(fileId in s.fileContents);
      if (isNewFile) {
        newFileIds.push(fileId);
        fetch("/api/files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "delete", project: s.projectName, filePath: fileId }),
        }).catch(() => {});
      } else {
        // Restore edit or deleted file by writing baseline back to disk
        fetch("/api/files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "write",
            project: s.projectName,
            filePath: fileId,
            content: s.fileContents[fileId] ?? "",
          }),
        }).catch(() => {});
      }
    }
    const openFiles = newFileIds.length > 0
      ? s.openFiles.filter((f) => !newFileIds.includes(f))
      : s.openFiles;
    const activeFile = newFileIds.includes(s.activeFile)
      ? (openFiles[openFiles.length - 1] || "")
      : s.activeFile;
    set({ pendingChanges: {}, openFiles, activeFile });
  },

  // Terminal
  terminalHistory: [],
  addTerminalHistory: (cmd) =>
    set((s) => ({ terminalHistory: [...s.terminalHistory, cmd] })),

  // Code execution
  isRunning: false,
  setIsRunning: (v) => set({ isRunning: v }),
  lintErrors: [],
  setLintErrors: (errors) => set({ lintErrors: errors }),

  // Per-file diagnostics
  fileDiagnostics: {},
  setFileDiagnostics: (fileId, d) =>
    set((s) => ({ fileDiagnostics: { ...s.fileDiagnostics, [fileId]: d } })),
  clearFileDiagnostics: (fileId) =>
    set((s) => {
      const next = { ...s.fileDiagnostics };
      delete next[fileId];
      return { fileDiagnostics: next };
    }),

  // Preview
  device: "desktop",
  zoom: 100,
  previewUrl: "http://localhost:3000",
  setDevice: (d) => set({ device: d }),
  setZoom: (z) => set({ zoom: Math.max(30, Math.min(200, z)) }),
  setPreviewUrl: (url) => set({ previewUrl: url }),

  // AI
  aiInput: "",
  aiModel: "claude-sonnet-4-6",
  aiEffort: "medium",
  loadingConvIds: [],
  setAiInput: (v) => set({ aiInput: v }),
  setAiModel: (v) => set({ aiModel: v }),
  setAiEffort: (v) => set({ aiEffort: v }),
  setConvLoading: (convId, loading) =>
    set((s) => {
      const has = s.loadingConvIds.includes(convId);
      if (loading && !has) return { loadingConvIds: [...s.loadingConvIds, convId] };
      if (!loading && has) return { loadingConvIds: s.loadingConvIds.filter((c) => c !== convId) };
      return s;
    }),
  isConvLoading: (convId) => get().loadingConvIds.includes(convId),

  // Trusted conversations (auto-bypass after first Allow)
  trustedConvIds: [],
  trustConversation: (id) =>
    set((s) => s.trustedConvIds.includes(id) ? s : { trustedConvIds: [...s.trustedConvIds, id] }),
  untrustConversation: (id) =>
    set((s) => ({ trustedConvIds: s.trustedConvIds.filter((c) => c !== id) })),

  // Conversations
  conversations: [initialConv],
  activeConvByProject: { "": initialConv.id },
  activeConversationId: initialConv.id,
  newConversation: () => {
    const project = get().projectName || "";
    const conv = makeConversation(project);
    set((s) => ({
      conversations: [...s.conversations, conv],
      activeConvByProject: { ...s.activeConvByProject, [project]: conv.id },
      activeConversationId: conv.id,
    }));
    return conv.id;
  },
  newConversationForProject: (project) => {
    const conv = makeConversation(project);
    set((s) => ({
      conversations: [...s.conversations, conv],
      activeConvByProject: { ...s.activeConvByProject, [project]: conv.id },
    }));
    return conv.id;
  },
  ensureConvForProject: (project) => {
    const s = get();
    let convId = s.activeConvByProject[project];
    if (convId && s.conversations.find((c) => c.id === convId)) return convId;
    const candidates = s.conversations
      .filter((c) => (c.projectName ?? "") === project)
      .sort((a, b) => b.createdAt - a.createdAt);
    if (candidates.length > 0) {
      convId = candidates[0].id;
      set((prev) => ({ activeConvByProject: { ...prev.activeConvByProject, [project]: convId } }));
      return convId;
    }
    const conv = makeConversation(project);
    set((prev) => ({
      conversations: [...prev.conversations, conv],
      activeConvByProject: { ...prev.activeConvByProject, [project]: conv.id },
    }));
    return conv.id;
  },
  switchConversation: (id) => {
    const conv = get().conversations.find((c) => c.id === id);
    const project = conv?.projectName ?? get().projectName ?? "";
    set((s) => ({
      activeConversationId: id,
      activeConvByProject: { ...s.activeConvByProject, [project]: id },
    }));
  },
  deleteConversation: (id) => {
    set((s) => {
      const target = s.conversations.find((c) => c.id === id);
      const project = target?.projectName ?? "";
      const conversations = s.conversations.filter((c) => c.id !== id);
      const trustedConvIds = s.trustedConvIds.filter((c) => c !== id);
      const activeConvByProject = { ...s.activeConvByProject };

      // If the deleted conv was the active one for its project, pick another
      // conversation from the same project (newest first) or null.
      if (activeConvByProject[project] === id) {
        const sameProject = conversations
          .filter((c) => (c.projectName ?? "") === project)
          .sort((a, b) => b.createdAt - a.createdAt);
        if (sameProject.length > 0) {
          activeConvByProject[project] = sameProject[0].id;
        } else {
          delete activeConvByProject[project];
        }
      }

      // Derive activeConversationId from current project's active conv.
      const currentProject = s.projectName || "";
      let activeConversationId = activeConvByProject[currentProject] ?? "";

      // If no conversations left at all, seed a fresh one for the current project.
      if (conversations.length === 0) {
        const newConv = makeConversation(currentProject);
        return {
          conversations: [newConv],
          activeConvByProject: { ...activeConvByProject, [currentProject]: newConv.id },
          activeConversationId: newConv.id,
          trustedConvIds,
        };
      }

      // If the current project has no active conv (e.g., deleted the only one),
      // fall back to most recent conv overall — caller (UI) will normalize.
      if (!activeConversationId) {
        activeConversationId = conversations[conversations.length - 1].id;
      }

      return { conversations, activeConvByProject, activeConversationId, trustedConvIds };
    });
  },
  addMessageToConversation: (id, msg) =>
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === id ? { ...c, messages: [...c.messages, msg] } : c
      ),
    })),
  updateLastMessageInConversation: (id, content) =>
    set((s) => ({
      conversations: s.conversations.map((c) => {
        if (c.id !== id) return c;
        const messages = [...c.messages];
        if (messages.length === 0) return c;
        messages[messages.length - 1] = { ...messages[messages.length - 1], content };
        return { ...c, messages };
      }),
    })),
  // Append a streamed text delta. Coalesces consecutive text chunks into the
  // trailing text segment so we don't blow up the segment array with one entry
  // per token. content is kept in sync as the concatenated text.
  appendTextSegmentToLastMessage: (id, chunk) =>
    set((s) => ({
      conversations: s.conversations.map((c) => {
        if (c.id !== id) return c;
        const messages = [...c.messages];
        if (messages.length === 0) return c;
        const last = messages[messages.length - 1];
        const segments = [...(last.segments ?? [])];
        const tail = segments[segments.length - 1];
        if (tail && tail.type === "text") {
          segments[segments.length - 1] = { type: "text", text: tail.text + chunk };
        } else {
          segments.push({ type: "text", text: chunk });
        }
        messages[messages.length - 1] = {
          ...last,
          segments,
          content: (last.content ?? "") + chunk,
        };
        return { ...c, messages };
      }),
    })),
  appendThinkingToLastMessage: (id, chunk) =>
    set((s) => ({
      conversations: s.conversations.map((c) => {
        if (c.id !== id) return c;
        const messages = [...c.messages];
        if (messages.length === 0) return c;
        const last = messages[messages.length - 1];
        messages[messages.length - 1] = {
          ...last,
          thinking: (last.thinking ?? "") + chunk,
        };
        return { ...c, messages };
      }),
    })),
  addToolCallToLastMessage: (id, tool) =>
    set((s) => ({
      conversations: s.conversations.map((c) => {
        if (c.id !== id) return c;
        const messages = [...c.messages];
        if (messages.length === 0) return c;
        const last = messages[messages.length - 1];
        // Push the tool as both a flat entry (legacy) AND a segment (ordered),
        // so the renderer can use segments to interleave text and tools.
        messages[messages.length - 1] = {
          ...last,
          toolCalls: [...(last.toolCalls ?? []), tool],
          segments: [...(last.segments ?? []), { type: "tool", tool }],
        };
        return { ...c, messages };
      }),
    })),
  setToolResultOnLastMessage: (id, toolUseId, result, isError) =>
    set((s) => ({
      conversations: s.conversations.map((c) => {
        if (c.id !== id) return c;
        const messages = [...c.messages];
        if (messages.length === 0) return c;
        // Find the most recent assistant message with a matching tool_use_id
        for (let i = messages.length - 1; i >= 0; i--) {
          const m = messages[i];
          if (m.role !== "assistant") continue;
          let hit = false;
          let nextTools = m.toolCalls;
          if (m.toolCalls) {
            const idx = m.toolCalls.findIndex((tc) => tc.id === toolUseId);
            if (idx >= 0) {
              nextTools = m.toolCalls.map((tc, j) =>
                j === idx ? { ...tc, result, isError, doneTs: Date.now() } : tc
              );
              hit = true;
            }
          }
          // Mirror onto the matching tool segment so the inline renderer shows
          // the result/elapsed/error in its right position in the message.
          let nextSegments = m.segments;
          if (m.segments) {
            nextSegments = m.segments.map((seg) =>
              seg.type === "tool" && seg.tool.id === toolUseId
                ? { ...seg, tool: { ...seg.tool, result, isError, doneTs: Date.now() } }
                : seg
            );
            if (!hit) hit = nextSegments.some(
              (seg) => seg.type === "tool" && seg.tool.id === toolUseId && seg.tool.result === result,
            );
          }
          if (hit) {
            messages[i] = { ...m, toolCalls: nextTools, segments: nextSegments };
            break;
          }
        }
        return { ...c, messages };
      }),
    })),
  setPermissionDenialsOnLastMessage: (id, denials) =>
    set((s) => ({
      conversations: s.conversations.map((c) => {
        if (c.id !== id) return c;
        const messages = [...c.messages];
        if (messages.length === 0) return c;
        const last = messages[messages.length - 1];
        messages[messages.length - 1] = { ...last, permissionDenials: denials };
        return { ...c, messages };
      }),
    })),
  setUserQuestionsOnLastMessage: (id, questions) =>
    set((s) => ({
      conversations: s.conversations.map((c) => {
        if (c.id !== id) return c;
        const messages = [...c.messages];
        if (messages.length === 0) return c;
        const last = messages[messages.length - 1];
        messages[messages.length - 1] = { ...last, userQuestions: questions };
        return { ...c, messages };
      }),
    })),
  removeLastAssistantMessage: (id) =>
    set((s) => ({
      conversations: s.conversations.map((c) => {
        if (c.id !== id) return c;
        const messages = [...c.messages];
        // Remove trailing assistant message if any
        if (messages.length > 0 && messages[messages.length - 1].role === "assistant") {
          messages.pop();
        }
        return { ...c, messages };
      }),
    })),
  setConversationTitle: (id, title) =>
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === id ? { ...c, title } : c
      ),
    })),
  setConversationSessionId: (id, sessionId) =>
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === id ? { ...c, sessionId } : c
      ),
    })),

  // API Keys
  apiKeys: [],
  selectedApiKeyName: "",
  addApiKey: (name, key) =>
    set((s) => ({
      apiKeys: [
        ...s.apiKeys.filter((k) => k.name !== name),
        { name, key },
      ],
      selectedApiKeyName: name,
    })),
  removeApiKey: (name) =>
    set((s) => {
      const apiKeys = s.apiKeys.filter((k) => k.name !== name);
      const selectedApiKeyName =
        s.selectedApiKeyName === name
          ? apiKeys[0]?.name || ""
          : s.selectedApiKeyName;
      return { apiKeys, selectedApiKeyName };
    }),
  selectApiKey: (name) => set({ selectedApiKeyName: name }),

  // Navigation
  currentView: "code",
  setCurrentView: (v) => set({ currentView: v }),

  // Explorer
  explorerBusy: false,
  setExplorerBusy: (v) => set({ explorerBusy: v }),
  isRefreshing: false,
  setIsRefreshing: (v) => set({ isRefreshing: v }),

  // Transfer
  transferActive: false,
  transferProgress: 0,
  transferStatus: "",
  transferType: "",
  setTransfer: (active, progress, status, type) =>
    set({ transferActive: active, transferProgress: progress, transferStatus: status, transferType: type }),

  // Load full project
  loadProject: (tree, contents, rootFiles, folderOpen) => {
    const safeRootFiles = rootFiles || [];
    const safeTree = tree || {};
    const firstFile = safeRootFiles.find((id: string) => safeTree[id]?.type === "file") || "";
    // Merge persisted folder state over API defaults, keeping only keys present in new tree
    const savedFolderOpen = get().folderOpen;
    const validKeys = new Set(Object.keys(safeTree));
    const merged: Record<string, boolean> = {};
    for (const [k, v] of Object.entries({ ...(folderOpen || {}), ...savedFolderOpen })) {
      if (validKeys.has(k)) merged[k] = v;
    }
    set({
      fileTree: safeTree,
      fileContents: contents || {},
      rootFiles: safeRootFiles,
      folderOpen: merged,
      activeFile: firstFile,
      openFiles: firstFile ? [firstFile] : [],
      lintErrors: [],
      pendingChanges: {},
    });

    if (firstFile && !(firstFile in (contents || {}))) {
      const project = get().projectName;
      if (project) {
        fetch(`/api/files/content?project=${encodeURIComponent(project)}&file=${encodeURIComponent(firstFile)}`)
          .then((r) => r.json())
          .then((data) => {
            set((curr) => ({
              fileContents: { ...curr.fileContents, [firstFile]: data.content ?? "" },
            }));
          })
          .catch(() => {});
      }
    }
  },
    }),
    {
      name: "sofi-chat",
      storage: safeStorage,
      partialize: (state) => ({
        // Strip the heavyweight fields before persisting:
        // - snapshot / snapshotFiles: each user message stores the full file
        //   contents of the project at send time. Even a medium project blows
        //   past localStorage's quota after a handful of messages. Trade-off:
        //   "Revert to here" stops working after a page reload, but the app
        //   keeps running.
        // - toolCalls[].result: Read/Bash/Grep outputs can be huge. We keep
        //   the first 2 KB so the user can still see what the tool returned.
        conversations: state.conversations.map((c) => ({
          ...c,
          messages: c.messages.map((m) => {
            const { snapshot, snapshotFiles, ...rest } = m;
            void snapshot; void snapshotFiles;
            if (rest.toolCalls) {
              rest.toolCalls = rest.toolCalls.map((tc) => {
                if (!tc.result || tc.result.length <= 2048) return tc;
                return { ...tc, result: tc.result.slice(0, 2048) + "\n…[truncated]" };
              });
            }
            if (rest.segments) {
              rest.segments = rest.segments.map((seg) => {
                if (seg.type !== "tool") return seg;
                const t = seg.tool;
                if (!t.result || t.result.length <= 2048) return seg;
                return { ...seg, tool: { ...t, result: t.result.slice(0, 2048) + "\n…[truncated]" } };
              });
            }
            return rest;
          }),
        })),
        activeConversationId: state.activeConversationId,
        activeConvByProject: state.activeConvByProject,
        aiModel: state.aiModel,
        aiEffort: state.aiEffort,
        projectName: state.projectName,
        folderOpen: state.folderOpen,
        trustedConvIds: state.trustedConvIds,
      }),
    }
  )
);
