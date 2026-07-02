// biome-ignore-all lint: Pi SDK/websocket wire data is dynamic in this MVP.
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import { ChatPane } from "./ChatPane";
import { ControlRoom } from "./ControlRoom";
import { FilePane } from "./FilePane";
import { TerminalPane } from "./TerminalPane";
import type {
  AttachedImage,
  FileEntry,
  ModelInfo,
  SessionInfo,
  Theme,
  ToolInfo,
} from "./types";
import "./styles.css";

type Tab = "chat" | "terminal" | "file" | "settings";
type SidebarLayout = {
  sidebarWidth: number;
  cwdHeight: number;
  sessionsHeight: number;
};

const SIDEBAR_LAYOUT_STORAGE_KEY = "pi-web.sidebar-layout";
const THEME_STORAGE_KEY = "pi-web.theme";
const DEFAULT_SIDEBAR_LAYOUT: SidebarLayout = {
  sidebarWidth: 310,
  cwdHeight: 140,
  sessionsHeight: 280,
};
const SIDEBAR_MIN_WIDTH = 240;
const SIDEBAR_MAX_WIDTH = 620;
const CWD_MIN_HEIGHT = 132;
const CWD_MAX_HEIGHT = 260;
const SIDEBAR_PANEL_MIN_HEIGHT = 140;

function clamp(value: number, min: number, max: number): number {
  const safeMax = Math.max(min, max);
  return Math.min(Math.max(value, min), safeMax);
}

function loadSidebarLayout(): SidebarLayout {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(SIDEBAR_LAYOUT_STORAGE_KEY) ?? "{}",
    );
    return {
      sidebarWidth: clamp(
        Number(parsed.sidebarWidth) || DEFAULT_SIDEBAR_LAYOUT.sidebarWidth,
        SIDEBAR_MIN_WIDTH,
        SIDEBAR_MAX_WIDTH,
      ),
      cwdHeight: clamp(
        Number(parsed.cwdHeight) || DEFAULT_SIDEBAR_LAYOUT.cwdHeight,
        CWD_MIN_HEIGHT,
        CWD_MAX_HEIGHT,
      ),
      sessionsHeight: clamp(
        Number(parsed.sessionsHeight) || DEFAULT_SIDEBAR_LAYOUT.sessionsHeight,
        SIDEBAR_PANEL_MIN_HEIGHT,
        720,
      ),
    };
  } catch {
    return DEFAULT_SIDEBAR_LAYOUT;
  }
}

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

function formatRelativeTime(value: string): string {
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return "unknown";
  const diffSeconds = Math.round((time - Date.now()) / 1000);
  const ranges: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 60 * 60 * 24 * 365],
    ["month", 60 * 60 * 24 * 30],
    ["week", 60 * 60 * 24 * 7],
    ["day", 60 * 60 * 24],
    ["hour", 60 * 60],
    ["minute", 60],
  ];
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  for (const [unit, seconds] of ranges) {
    if (Math.abs(diffSeconds) >= seconds) {
      return formatter.format(Math.round(diffSeconds / seconds), unit);
    }
  }
  return "just now";
}

function noticeTone(message: string): "warning" | "danger" | "ok" | "info" {
  const text = message.toLowerCase();
  if (text.includes("rejected") || text.includes("warning")) return "warning";
  if (text.includes("error") || text.includes("failed")) return "danger";
  if (
    text.includes("saved") ||
    text.includes("updated") ||
    text.includes("copied")
  )
    return "ok";
  return "info";
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? res.statusText);
  return json as T;
}

function App() {
  const [defaultCwd, setDefaultCwd] = useState<string>("");
  const [cwd, setCwd] = useState<string>("");
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [sessionFilter, setSessionFilter] = useState("");
  const [selected, setSelected] = useState<SessionInfo | null>(null);
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
  const [sidebarLayout, setSidebarLayout] = useState<SidebarLayout>(() =>
    loadSidebarLayout(),
  );
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [filePath, setFilePath] = useState("");
  const [file, setFile] = useState<any>(null);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const eventsRef = useRef<EventSource | null>(null);

  const selectedId = selected?.id;
  const activeCwd = selected?.cwd || cwd || defaultCwd;
  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    localStorage.setItem(THEME_STORAGE_KEY, next);
  }, []);
  const filteredSessions = useMemo(() => {
    const query = sessionFilter.trim().toLowerCase();
    if (!query) return sessions;
    return sessions.filter((session) =>
      [session.name, session.firstMessage, session.cwd]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query)),
    );
  }, [sessions, sessionFilter]);

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
    const events = new EventSource(
      `/api/files/watch?cwd=${encodeURIComponent(activeCwd)}&path=${encodeURIComponent(filePath)}`,
    );
    events.onmessage = (message) => {
      const event = JSON.parse(message.data);
      if (event.type === "ready" || event.type === "change") void loadFiles();
    };
    events.onerror = () => events.close();
    return () => events.close();
  }, [activeCwd, filePath, loadFiles]);

  useEffect(() => {
    localStorage.setItem(
      SIDEBAR_LAYOUT_STORAGE_KEY,
      JSON.stringify(sidebarLayout),
    );
  }, [sidebarLayout]);

  function availableSidebarPaneHeight() {
    return Math.max(
      SIDEBAR_PANEL_MIN_HEIGHT * 2 + CWD_MIN_HEIGHT,
      (sidebarRef.current?.clientHeight ?? window.innerHeight) - 86,
    );
  }

  function startSidebarWidthResize(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarLayout.sidebarWidth;
    document.body.classList.add("resizing");
    const onMove = (moveEvent: PointerEvent) => {
      setSidebarLayout((value) => ({
        ...value,
        sidebarWidth: clamp(
          startWidth + moveEvent.clientX - startX,
          SIDEBAR_MIN_WIDTH,
          SIDEBAR_MAX_WIDTH,
        ),
      }));
    };
    const onEnd = () => {
      document.body.classList.remove("resizing");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
  }

  function startPaneResize(
    pane: "cwd" | "sessions",
    event: React.PointerEvent<HTMLDivElement>,
  ) {
    event.preventDefault();
    const startY = event.clientY;
    const startCwdHeight = sidebarLayout.cwdHeight;
    const startSessionsHeight = sidebarLayout.sessionsHeight;
    document.body.classList.add("resizing");
    const onMove = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientY - startY;
      const available = availableSidebarPaneHeight();
      setSidebarLayout((value) => {
        if (pane === "cwd") {
          const cwdHeight = clamp(
            startCwdHeight + delta,
            CWD_MIN_HEIGHT,
            Math.min(CWD_MAX_HEIGHT, available - SIDEBAR_PANEL_MIN_HEIGHT * 2),
          );
          const sessionsHeight = clamp(
            value.sessionsHeight,
            SIDEBAR_PANEL_MIN_HEIGHT,
            available - cwdHeight - SIDEBAR_PANEL_MIN_HEIGHT,
          );
          return { ...value, cwdHeight, sessionsHeight };
        }
        return {
          ...value,
          sessionsHeight: clamp(
            startSessionsHeight + delta,
            SIDEBAR_PANEL_MIN_HEIGHT,
            available - value.cwdHeight - SIDEBAR_PANEL_MIN_HEIGHT,
          ),
        };
      });
    };
    const onEnd = () => {
      document.body.classList.remove("resizing");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
  }

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

  return (
    <div
      className="app"
      style={
        {
          "--sidebar-width": `${sidebarLayout.sidebarWidth}px`,
        } as React.CSSProperties
      }
    >
      <aside
        ref={sidebarRef}
        className="sidebar"
        style={
          {
            "--cwd-panel-height": `${sidebarLayout.cwdHeight}px`,
            "--sessions-panel-height": `${sidebarLayout.sessionsHeight}px`,
          } as React.CSSProperties
        }
      >
        <div className="sidebar-header">
          <div className="brand">π web</div>
          <button
            type="button"
            className="layout-reset"
            title="Restore default sidebar sizes"
            onClick={() => setSidebarLayout(DEFAULT_SIDEBAR_LAYOUT)}
          >
            Reset layout
          </button>
        </div>
        <section className="panel cwd-panel">
          <div className="panel-title">cwd</div>
          <input
            className="input"
            value={cwd}
            onChange={(event) => setCwd(event.target.value)}
          />
          <button className="primary" onClick={() => void newSession()}>
            New session
          </button>
        </section>
        <div
          className="pane-resizer"
          role="separator"
          aria-label="Resize CWD and sessions panels"
          aria-orientation="horizontal"
          onPointerDown={(event) => startPaneResize("cwd", event)}
        />
        <section className="panel sessions-panel">
          <div className="panel-title">
            Sessions
            <span>
              {filteredSessions.length}/{sessions.length}
            </span>
          </div>
          <input
            className="input sidebar-search"
            value={sessionFilter}
            onChange={(event) => setSessionFilter(event.target.value)}
            placeholder="Search sessions"
          />
          <div className="session-list">
            {filteredSessions.map((session) => {
              const title = session.name || session.firstMessage || "Untitled";
              return (
                <button
                  key={session.id}
                  className={`session ${selected?.id === session.id ? "active" : ""}`}
                  onClick={() => setSelected(session)}
                >
                  <span className="session-heading">
                    <span>{title}</span>
                    {selected?.id === session.id && <em>active</em>}
                  </span>
                  <small>{session.cwd}</small>
                  <span className="session-meta">
                    <span>{formatRelativeTime(session.modified)}</span>
                    <span>{session.messageCount} msgs</span>
                  </span>
                </button>
              );
            })}
            {filteredSessions.length === 0 && (
              <div className="empty-small">No matching sessions.</div>
            )}
          </div>
        </section>
        <div
          className="pane-resizer"
          role="separator"
          aria-label="Resize sessions and files panels"
          aria-orientation="horizontal"
          onPointerDown={(event) => startPaneResize("sessions", event)}
        />
        <section className="panel files">
          <div className="panel-title">
            <span>Files</span>
            <span className="auto-refresh">auto</span>
            {filePath && (
              <button
                className="link"
                onClick={() =>
                  setFilePath(filePath.split("/").slice(0, -1).join("/"))
                }
              >
                up
              </button>
            )}
          </div>
          <div className="file-path" title={filePath || "."}>
            {filePath || "."}
          </div>
          <div className="file-list">
            {files.map((entry) => (
              <button
                key={entry.path}
                className="file-row"
                onClick={() => void openFile(entry)}
              >
                <span>{entry.type === "directory" ? "▸" : "•"}</span>{" "}
                {entry.name}
              </button>
            ))}
          </div>
        </section>
      </aside>
      <div
        className="sidebar-width-resizer"
        role="separator"
        aria-label="Resize sidebar"
        aria-orientation="vertical"
        onPointerDown={startSidebarWidthResize}
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
            onNotice={setNotice}
            onSessionsChanged={async () => {
              await loadSessions();
              setSelected(null);
            }}
          />
        )}
        {tab === "file" && <FilePane file={file} />}
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
