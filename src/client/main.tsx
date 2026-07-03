// biome-ignore-all lint: Pi SDK/websocket wire data is dynamic in this MVP.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { api } from "./api";
import { ChatPane } from "./ChatPane";
import { ControlRoom } from "./ControlRoom";
import { FilePane } from "./FilePane";
import { Sidebar } from "./Sidebar";
import { TerminalPane } from "./TerminalPane";
import type {
  AttachedImage,
  FileEntry,
  ModelInfo,
  SessionInfo,
  Theme,
  ToolInfo,
} from "./types";
import { noticeTone, sessionTitle } from "./uiText";
import "./styles.css";

type Tab = "chat" | "terminal" | "file" | "settings";

const THEME_STORAGE_KEY = "pi-web.theme";
const FILE_REFRESH_DEBOUNCE_MS = 150;

function loadTheme(): Theme {
  const value = localStorage.getItem(THEME_STORAGE_KEY);
  return value === "dark" || value === "light" ? value : "system";
}

function resolvedTheme(theme: Theme): Exclude<Theme, "system"> {
  if (theme !== "system") return theme;
  return window.matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

function applyTheme(theme: Theme) {
  const next = resolvedTheme(theme);
  document.documentElement.dataset.theme = next;
  document.documentElement.style.colorScheme = next;
}

function App() {
  const [defaultCwd, setDefaultCwd] = useState<string>("");
  const [cwd, setCwd] = useState<string>("");
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [selected, setSelected] = useState<SessionInfo | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SessionInfo | null>(null);
  const [deletingSessionId, setDeletingSessionId] = useState("");
  const [messages, setMessages] = useState<any[]>([]);
  const [streamText, setStreamText] = useState("");
  const [streamThinking, setStreamThinking] = useState("");
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<any>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [commands, setCommands] = useState<any[]>([]);
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState<Tab>("chat");
  const [theme, setThemeState] = useState<Theme>(() => loadTheme());
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [filePath, setFilePath] = useState("");
  const [file, setFile] = useState<any>(null);
  const eventsRef = useRef<EventSource | null>(null);

  const selectedId = selected?.id;
  const activeCwd = selected?.cwd || cwd || defaultCwd;
  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    localStorage.setItem(THEME_STORAGE_KEY, next);
  }, []);
  const loadSessions = useCallback(async () => {
    const data = await api<{ sessions: SessionInfo[] }>("/api/sessions");
    setSessions(data.sessions);
  }, []);

  const loadMessages = useCallback(
    async (id = selectedId) => {
      if (!id) return;
      const data = await api<{ messages: any[] }>(
        `/api/sessions/${id}/messages`,
      );
      setMessages(data.messages);
    },
    [selectedId],
  );

  const loadTools = useCallback(
    async (id = selectedId) => {
      if (!id) return;
      const data = await api<{ tools: ToolInfo[] }>(
        `/api/sessions/${id}/tools`,
      );
      setTools(data.tools);
    },
    [selectedId],
  );

  const loadCommands = useCallback(
    async (id = selectedId) => {
      if (!id) return;
      const data = await api<{ commands: any[] }>(
        `/api/sessions/${id}/commands`,
      );
      setCommands(data.commands);
    },
    [selectedId],
  );

  const loadStatus = useCallback(
    async (id = selectedId) => {
      if (!id) return;
      const data = await api<{ running: boolean; status: any }>(
        `/api/sessions/${id}/status`,
      );
      setStatus(data.status);
      setRunning(Boolean(data.status?.isStreaming));
    },
    [selectedId],
  );

  const connectEvents = useCallback(
    (id: string) => {
      eventsRef.current?.close();
      const es = new EventSource(`/api/sessions/${id}/events`);
      eventsRef.current = es;
      es.onmessage = (message) => {
        const event = JSON.parse(message.data);
        if (event.type === "connected") {
          setStatus(event.status);
          setRunning(Boolean(event.status?.isStreaming));
        } else if (event.type === "status") {
          setStatus(event.status);
          setRunning(Boolean(event.status?.isStreaming));
        } else if (event.type === "agent_start") {
          setRunning(true);
          setStreamText("");
          setStreamThinking("");
        } else if (event.type === "message_update") {
          const delta = event.assistantMessageEvent;
          if (delta?.type === "text_delta")
            setStreamText((value) => value + delta.delta);
          if (delta?.type === "thinking_delta")
            setStreamThinking((value) => value + delta.delta);
        } else if (event.type === "tool_execution_start") {
          setMessages((value) => [
            ...value,
            {
              role: "toolResult",
              toolName: event.toolName,
              toolCallId: event.toolCallId,
              content: [{ type: "text", text: `Running ${event.toolName}...` }],
            },
          ]);
        } else if (event.type === "tool_execution_update") {
          const text =
            event.partialResult?.content
              ?.map((c: any) => c.text ?? "")
              .join("") ?? "";
          setMessages((value) =>
            value.map((msg) =>
              msg.toolCallId === event.toolCallId
                ? { ...msg, content: [{ type: "text", text }] }
                : msg,
            ),
          );
        } else if (event.type === "tool_execution_end") {
          const text =
            event.result?.content?.map((c: any) => c.text ?? "").join("") ?? "";
          setMessages((value) =>
            value.map((msg) =>
              msg.toolCallId === event.toolCallId
                ? {
                    ...msg,
                    isError: event.isError,
                    content: [{ type: "text", text }],
                  }
                : msg,
            ),
          );
        } else if (event.type === "agent_end" || event.type === "prompt_done") {
          setRunning(false);
          setStreamText("");
          setStreamThinking("");
          void loadMessages(id);
          void loadSessions();
          void loadStatus(id);
        } else if (event.type === "session_error") {
          setNotice(event.message);
          setRunning(false);
        } else if (event.type === "extension_ui" && event.method === "notify") {
          setNotice(event.message);
        }
      };
      es.onerror = () => setNotice("Event stream disconnected");
    },
    [loadMessages, loadSessions, loadStatus],
  );

  useEffect(() => {
    void api<{ defaultCwd: string }>("/api/config").then((config) => {
      setDefaultCwd(config.defaultCwd);
      setCwd(config.defaultCwd);
    });
    void loadSessions();
    void api<{ models: ModelInfo[] }>("/api/models")
      .then((data) => setModels(data.models))
      .catch((error) => setNotice(error.message));
    return () => eventsRef.current?.close();
  }, [loadSessions]);

  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const sync = () => applyTheme(theme);
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [theme]);

  useEffect(() => {
    if (!selected) return;
    setCwd(selected.cwd);
    setTab("chat");
    void loadMessages(selected.id);
    void loadStatus(selected.id);
    void loadTools(selected.id);
    void loadCommands(selected.id);
    connectEvents(selected.id);
  }, [
    selected,
    loadMessages,
    loadStatus,
    loadTools,
    loadCommands,
    connectEvents,
  ]);

  const loadFiles = useCallback(async () => {
    if (!activeCwd) return;
    try {
      const data = await api<{ entries: FileEntry[] }>(
        `/api/files/tree?cwd=${encodeURIComponent(activeCwd)}&path=${encodeURIComponent(filePath)}`,
      );
      setFiles(data.entries);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }, [activeCwd, filePath]);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

  useEffect(() => {
    if (!activeCwd) return;
    let refreshTimer = 0;
    const scheduleLoadFiles = () => {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(
        () => void loadFiles(),
        FILE_REFRESH_DEBOUNCE_MS,
      );
    };
    const events = new EventSource(
      `/api/files/watch?cwd=${encodeURIComponent(activeCwd)}&path=${encodeURIComponent(filePath)}`,
    );
    events.onmessage = (message) => {
      const event = JSON.parse(message.data);
      if (event.type === "ready" || event.type === "change")
        scheduleLoadFiles();
    };
    events.onerror = () => events.close();
    return () => {
      window.clearTimeout(refreshTimer);
      events.close();
    };
  }, [activeCwd, filePath, loadFiles]);

  async function newSession() {
    const data = await api<{ session: SessionInfo; status: any }>(
      "/api/sessions",
      {
        method: "POST",
        body: JSON.stringify({ cwd }),
      },
    );
    setSelected(data.session);
    setStatus(data.status);
    await loadSessions();
  }

  async function ensureSession(): Promise<SessionInfo> {
    if (selected) return selected;
    const data = await api<{ session: SessionInfo; status: any }>(
      "/api/sessions",
      {
        method: "POST",
        body: JSON.stringify({ cwd }),
      },
    );
    setSelected(data.session);
    setStatus(data.status);
    connectEvents(data.session.id);
    await loadSessions();
    return data.session;
  }

  async function sendPrompt(
    text: string,
    images?: AttachedImage[],
    streamingBehavior?: "steer" | "followUp",
  ) {
    const session = await ensureSession();
    if (!streamingBehavior)
      setMessages((value) => [
        ...value,
        {
          role: "user",
          content: images?.length
            ? [
                { type: "text", text },
                ...images.map((image) => ({
                  type: "image",
                  data: image.data,
                  mimeType: image.mimeType,
                })),
              ]
            : text,
        },
      ]);
    setRunning(true);
    await api(`/api/sessions/${session.id}/prompt`, {
      method: "POST",
      body: JSON.stringify({ text, images, streamingBehavior }),
    });
  }

  async function openFile(entry: FileEntry) {
    if (entry.type === "directory") {
      setFilePath(entry.path);
      return;
    }
    const data = await api<any>(
      `/api/files/content?cwd=${encodeURIComponent(activeCwd)}&path=${encodeURIComponent(entry.path)}`,
    );
    setFile(data);
    setTab("file");
  }

  async function saveTools(next: string[]) {
    if (!selectedId) return;
    await api(`/api/sessions/${selectedId}/tools`, {
      method: "POST",
      body: JSON.stringify({ toolNames: next }),
    });
    await loadTools(selectedId);
  }

  async function setModel(value: string) {
    if (!selectedId || !value) return;
    const [provider, ...rest] = value.split("/");
    await api(`/api/sessions/${selectedId}/model`, {
      method: "POST",
      body: JSON.stringify({ provider, modelId: rest.join("/") }),
    });
    await loadStatus(selectedId);
  }

  async function setThinking(level: string) {
    if (!selectedId) return;
    await api(`/api/sessions/${selectedId}/thinking`, {
      method: "POST",
      body: JSON.stringify({ level }),
    });
    await loadStatus(selectedId);
  }

  function requestSessionDelete(
    session: SessionInfo,
    event?: React.MouseEvent<HTMLElement>,
  ) {
    event?.stopPropagation();
    setDeleteTarget(session);
  }

  async function confirmSessionDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeletingSessionId(target.id);
    try {
      await api(`/api/sessions/${target.id}`, { method: "DELETE" });
      setSessions((value) => value.filter((item) => item.id !== target.id));
      if (selectedId === target.id) {
        eventsRef.current?.close();
        eventsRef.current = null;
        setSelected(null);
        setMessages([]);
        setStreamText("");
        setStreamThinking("");
        setRunning(false);
        setStatus(null);
        setTools([]);
        setCommands([]);
      }
      await loadSessions();
      setDeleteTarget(null);
      setNotice(`Deleted session “${sessionTitle(target)}”`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setDeletingSessionId("");
    }
  }

  return (
    <div className="app">
      <Sidebar
        cwd={cwd}
        sessions={sessions}
        selected={selected}
        deletingSessionId={deletingSessionId}
        files={files}
        filePath={filePath}
        onCwd={setCwd}
        onNewSession={() => void newSession()}
        onSelectSession={setSelected}
        onDeleteSession={requestSessionDelete}
        onFilePath={setFilePath}
        onOpenFile={(entry) => void openFile(entry)}
      />

      <main className="main">
        <header className="topbar">
          <div className="tabs">
            <button
              className={tab === "chat" ? "active" : ""}
              onClick={() => setTab("chat")}
            >
              Chat
            </button>
            <button
              className={tab === "terminal" ? "active" : ""}
              onClick={() => setTab("terminal")}
            >
              Terminal
            </button>
            <button
              className={tab === "settings" ? "active" : ""}
              onClick={() => setTab("settings")}
            >
              Control room
            </button>
            {file && (
              <button
                className={tab === "file" ? "active" : ""}
                onClick={() => setTab("file")}
              >
                File
              </button>
            )}
          </div>
          <div className="statusline">
            {status?.model
              ? `${status.model.provider}/${status.model.id}`
              : "auto model"}
            {running ? " · running" : " · idle"}
          </div>
        </header>
        {notice && (
          <div className={`notice ${noticeTone(notice)}`} role="status">
            <span className="notice-icon" aria-hidden="true">
              {noticeTone(notice) === "warning" ? "⚠" : "•"}
            </span>
            <strong>{notice}</strong>
            <button type="button" onClick={() => setNotice("")}>
              Dismiss
            </button>
          </div>
        )}
        {tab === "chat" && (
          <ChatPane
            messages={messages}
            streamText={streamText}
            streamThinking={streamThinking}
            running={running}
            hasSession={Boolean(selected)}
            cwd={activeCwd}
            onOpenTerminal={() => setTab("terminal")}
            onSend={sendPrompt}
            onAbort={async () =>
              selectedId &&
              api(`/api/sessions/${selectedId}/abort`, {
                method: "POST",
                body: "{}",
              }).then(() => setRunning(false))
            }
            onCompact={async () =>
              selectedId &&
              api(`/api/sessions/${selectedId}/compact`, {
                method: "POST",
                body: "{}",
              }).then(() => loadMessages(selectedId))
            }
            status={status}
            models={models}
            onModel={setModel}
            onThinking={setThinking}
            tools={tools}
            onTools={saveTools}
            commands={commands}
          />
        )}
        {tab === "terminal" && <TerminalPane cwd={activeCwd} />}
        {tab === "settings" && (
          <ControlRoom
            cwd={activeCwd}
            selected={selected}
            status={status}
            models={models}
            tools={tools}
            theme={theme}
            onTheme={setTheme}
            onModel={setModel}
            onTools={saveTools}
            onDeleteSession={requestSessionDelete}
            onNotice={setNotice}
            onSessionsChanged={async () => {
              await loadSessions();
              setSelected(null);
            }}
          />
        )}
        {tab === "file" && <FilePane file={file} />}
      </main>
      {deleteTarget && (
        <div className="delete-dialog-backdrop">
          <button
            type="button"
            className="delete-dialog-scrim"
            aria-label="Cancel delete"
            onClick={() => {
              if (deletingSessionId !== deleteTarget.id) setDeleteTarget(null);
            }}
          />
          <section
            className="delete-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-session-title"
          >
            <div className="delete-dialog-icon" aria-hidden="true">
              ×
            </div>
            <div>
              <div className="panel-title">Delete session</div>
              <h2 id="delete-session-title">{sessionTitle(deleteTarget)}</h2>
              <p>
                This removes the session transcript file. The workspace files
                stay untouched.
              </p>
              <div className="delete-dialog-meta">
                <span>{deleteTarget.cwd}</span>
                <span>{deleteTarget.messageCount} msgs</span>
              </div>
            </div>
            <div className="delete-dialog-actions">
              <button
                type="button"
                disabled={deletingSessionId === deleteTarget.id}
                onClick={() => setDeleteTarget(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="danger"
                disabled={deletingSessionId === deleteTarget.id}
                onClick={() => void confirmSessionDelete()}
              >
                {deletingSessionId === deleteTarget.id
                  ? "Deleting…"
                  : "Delete session"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
