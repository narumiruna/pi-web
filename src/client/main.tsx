// biome-ignore-all lint: Pi SDK/websocket wire data is dynamic in this MVP.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { AppNavigation, type AppTab } from "./AppNavigation";
import type { ValidationSummary } from "./agentTimeline";
import { api } from "./api";
import {
  createLatestRequestGate,
  createSingleFlight,
  isCurrentSelection,
} from "./asyncState";
import { ChatPane } from "./ChatPane";
import { ControlRoom } from "./ControlRoom";
import {
  COMPOSER_ATTACH_IMAGE_EVENT,
  COMPOSER_DRAFT_EVENT,
  COMPOSER_FOCUS_EVENT,
  type ComposerIntent,
  composerIntentFromEvent,
} from "./composerIntents";
import { DiffPane } from "./DiffPane";
import { EvaluationPane } from "./EvaluationPane";
import { FilePane } from "./FilePane";
import { PreviewPane } from "./PreviewPane";
import { ReplayPane } from "./ReplayPane";
import { isMobileLayout, shouldAutoHideSidebar } from "./responsiveLayout";
import { Sidebar } from "./Sidebar";
import { sessionCreationPayload } from "./sessionCreation";
import { shortcutAction, shortcutHelp } from "./shortcuts";
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
import { type UsageSnapshot, usageFromStatus } from "./usage";
import { ValidationPanel } from "./ValidationPanel";
import { WorkbenchPane } from "./WorkbenchPane";
import "./styles.css";

const THEME_STORAGE_KEY = "pi-web.theme";
const FILE_REFRESH_DEBOUNCE_MS = 150;

function loadTheme(): Theme {
  const value = localStorage.getItem(THEME_STORAGE_KEY);
  return value === "dark" || value === "light" || value === "system"
    ? value
    : "light";
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

function noticeIcon(tone: ReturnType<typeof noticeTone>) {
  if (tone === "warning") return "⚠";
  if (tone === "danger") return "!";
  if (tone === "ok") return "✓";
  return "•";
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
  const [tab, setTab] = useState<AppTab>("chat");
  const [permissionProfile, setPermissionProfile] = useState("ask");
  const [creatingSession, setCreatingSession] = useState(false);
  const [usageHistory, setUsageHistory] = useState<UsageSnapshot[]>([]);
  const [lastValidation, setLastValidation] =
    useState<ValidationSummary | null>(null);
  const [locateMessage, setLocateMessage] = useState<number | null>(null);
  const [sidebarHidden, setSidebarHidden] = useState(() =>
    isMobileLayout(window.innerWidth),
  );
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpQuery, setHelpQuery] = useState("");
  const helpReturnFocus = useRef<HTMLElement | null>(null);
  const [theme, setThemeState] = useState<Theme>(() => loadTheme());
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [filePath, setFilePath] = useState("");
  const [file, setFile] = useState<any>(null);
  const [composerIntents, setComposerIntents] = useState<ComposerIntent[]>([]);
  const eventsRef = useRef<EventSource | null>(null);
  const composerIntentId = useRef(0);
  const optimisticMessageId = useRef(0);
  const sessionCreationFlight = useRef(
    createSingleFlight<SessionInfo>(),
  ).current;
  const fileContentGate = useRef(createLatestRequestGate()).current;
  const fileTreeGate = useRef(createLatestRequestGate()).current;
  const previousViewportWidth = useRef(window.innerWidth);

  const selectedId = selected?.id;
  const selectedRef = useRef<SessionInfo | null>(selected);
  selectedRef.current = selected;
  const activeCwd = selected?.cwd || cwd || defaultCwd;
  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    localStorage.setItem(THEME_STORAGE_KEY, next);
  }, []);
  const loadSessions = useCallback(async () => {
    const data = await api<{ sessions: SessionInfo[] }>("/api/sessions");
    setSessions(data.sessions);
  }, []);

  const loadModels = useCallback(async () => {
    const data = await api<{ models: ModelInfo[] }>("/api/models");
    setModels(data.models);
  }, []);

  const loadMessages = useCallback(
    async (id = selectedId) => {
      if (!id) return;
      const data = await api<{ messages: any[] }>(
        `/api/sessions/${id}/messages`,
      );
      if (isCurrentSelection(id, selectedRef.current?.id))
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
      if (isCurrentSelection(id, selectedRef.current?.id)) setTools(data.tools);
    },
    [selectedId],
  );

  const loadCommands = useCallback(
    async (id = selectedId) => {
      if (!id) return;
      const data = await api<{ commands: any[] }>(
        `/api/sessions/${id}/commands`,
      );
      if (isCurrentSelection(id, selectedRef.current?.id))
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
      if (!isCurrentSelection(id, selectedRef.current?.id)) return;
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
        if (!isCurrentSelection(id, selectedRef.current?.id)) return;
        const event = JSON.parse(message.data);
        if (event.type === "connected" || event.type === "status") {
          setStatus(event.status);
          const snapshot = usageFromStatus(event.status);
          setUsageHistory((value) => [...value.slice(-99), snapshot]);
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
      es.onerror = () => {
        if (isCurrentSelection(id, selectedRef.current?.id))
          setNotice("Event stream disconnected");
      };
    },
    [loadMessages, loadSessions, loadStatus],
  );

  useEffect(() => {
    void api<{ defaultCwd: string }>("/api/config").then((config) => {
      setDefaultCwd(config.defaultCwd);
      setCwd(config.defaultCwd);
    });
    void loadSessions();
    void api<{ profile: string }>("/api/permissions")
      .then((settings) => setPermissionProfile(settings.profile))
      .catch(() => undefined);
    void loadModels().catch((error) =>
      setNotice(`${error.message} — open Diagnostics to troubleshoot`),
    );
    return () => eventsRef.current?.close();
  }, [loadSessions, loadModels]);

  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const sync = () => applyTheme(theme);
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [theme]);

  useEffect(() => {
    const onResize = () => {
      const nextWidth = window.innerWidth;
      if (shouldAutoHideSidebar(previousViewportWidth.current, nextWidth))
        setSidebarHidden(true);
      previousViewportWidth.current = nextWidth;
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !sidebarHidden &&
        isMobileLayout(window.innerWidth)
      ) {
        event.preventDefault();
        setSidebarHidden(true);
        return;
      }
      const action = shortcutAction(event);
      if (!action) return;
      event.preventDefault();
      if (action === "newSession")
        void newSession().catch((error) =>
          setNotice(error instanceof Error ? error.message : String(error)),
        );
      if (action === "focusPrompt")
        window.dispatchEvent(new Event(COMPOSER_FOCUS_EVENT));
      if (action === "openChat") setTab("chat");
      if (action === "openTerminal") setTab("terminal");
      if (action === "openDiff") setTab("diff");
      if (action === "openValidation") setTab("validation");
      if (action === "abortAgent") void abortAgent();
      if (action === "toggleSidebar") setSidebarHidden((value) => !value);
      if (action === "toggleHelp") setHelpOpen((value) => !value);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  useEffect(() => {
    if (helpOpen) {
      helpReturnFocus.current = document.activeElement as HTMLElement | null;
      return;
    }
    setHelpQuery("");
    helpReturnFocus.current?.focus?.();
    helpReturnFocus.current = null;
  }, [helpOpen]);

  useEffect(() => {
    const enqueue = (event: Event) => {
      const intent = composerIntentFromEvent(
        (composerIntentId.current += 1),
        event,
      );
      if (!intent) return;
      setComposerIntents((value) => [...value, intent]);
      setTab("chat");
    };
    window.addEventListener(COMPOSER_DRAFT_EVENT, enqueue);
    window.addEventListener(COMPOSER_ATTACH_IMAGE_EVENT, enqueue);
    window.addEventListener(COMPOSER_FOCUS_EVENT, enqueue);
    return () => {
      window.removeEventListener(COMPOSER_DRAFT_EVENT, enqueue);
      window.removeEventListener(COMPOSER_ATTACH_IMAGE_EVENT, enqueue);
      window.removeEventListener(COMPOSER_FOCUS_EVENT, enqueue);
    };
  }, []);

  useEffect(() => {
    if (!selected) {
      eventsRef.current?.close();
      eventsRef.current = null;
      return;
    }
    setCwd(selected.cwd);
    setTab("chat");
    void Promise.all([
      loadMessages(selected.id),
      loadStatus(selected.id),
      loadTools(selected.id),
      loadCommands(selected.id),
    ]).catch((error) => {
      if (isCurrentSelection(selected.id, selectedRef.current?.id))
        setNotice(error instanceof Error ? error.message : String(error));
    });
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
    const request = fileTreeGate.next();
    if (!activeCwd) {
      setFiles([]);
      return;
    }
    try {
      const data = await api<{ entries: FileEntry[] }>(
        `/api/files/tree?cwd=${encodeURIComponent(activeCwd)}&path=${encodeURIComponent(filePath)}`,
      );
      if (fileTreeGate.isCurrent(request)) setFiles(data.entries);
    } catch (error) {
      if (fileTreeGate.isCurrent(request))
        setNotice(error instanceof Error ? error.message : String(error));
    }
  }, [activeCwd, filePath, fileTreeGate]);

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

  function resetSessionView() {
    fileContentGate.invalidate();
    fileTreeGate.invalidate();
    setMessages([]);
    setStreamText("");
    setStreamThinking("");
    setRunning(false);
    setStatus(null);
    setTools([]);
    setCommands([]);
    setFiles([]);
    setFilePath("");
    setFile(null);
  }

  async function createAndSelectSession(): Promise<SessionInfo> {
    return sessionCreationFlight.run(async () => {
      setCreatingSession(true);
      try {
        const data = await api<{ session: SessionInfo; status: any }>(
          "/api/sessions",
          {
            method: "POST",
            body: JSON.stringify(sessionCreationPayload(permissionProfile)),
          },
        );
        resetSessionView();
        selectedRef.current = data.session;
        setSelected(data.session);
        setStatus(data.status);
        connectEvents(data.session.id);
        await loadSessions();
        return data.session;
      } finally {
        setCreatingSession(false);
      }
    });
  }

  async function newSession(): Promise<SessionInfo> {
    return createAndSelectSession();
  }

  async function abortAgent() {
    if (!selectedId || !running) return;
    await api(`/api/sessions/${selectedId}/abort`, {
      method: "POST",
      body: "{}",
    });
    setRunning(false);
  }

  const consumeComposerIntents = useCallback((ids: number[]) => {
    const consumed = new Set(ids);
    setComposerIntents((value) =>
      value.filter((intent) => !consumed.has(intent.id)),
    );
  }, []);

  async function ensureSession(): Promise<SessionInfo> {
    return selectedRef.current ?? newSession();
  }

  async function sendPrompt(
    text: string,
    images?: AttachedImage[],
    streamingBehavior?: "steer" | "followUp",
  ) {
    const session = await ensureSession();
    const localMessageId = !streamingBehavior
      ? `optimistic-${(optimisticMessageId.current += 1)}`
      : undefined;
    if (
      localMessageId &&
      isCurrentSelection(session.id, selectedRef.current?.id)
    )
      setMessages((value) => [
        ...value,
        {
          id: localMessageId,
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
    const runningBeforeRequest = running;
    if (isCurrentSelection(session.id, selectedRef.current?.id))
      setRunning(true);
    try {
      await api(`/api/sessions/${session.id}/prompt`, {
        method: "POST",
        body: JSON.stringify({ text, images, streamingBehavior }),
      });
    } catch (error) {
      if (isCurrentSelection(session.id, selectedRef.current?.id)) {
        setRunning(runningBeforeRequest);
        if (localMessageId)
          setMessages((value) =>
            value.filter((message) => message.id !== localMessageId),
          );
      }
      setNotice(error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  async function openFile(entry: FileEntry) {
    const request = fileContentGate.next();
    if (entry.type === "directory") {
      setFilePath(entry.path);
      return;
    }
    try {
      const data = await api<any>(
        `/api/files/content?cwd=${encodeURIComponent(activeCwd)}&path=${encodeURIComponent(entry.path)}`,
      );
      if (!fileContentGate.isCurrent(request)) return;
      setFile(data);
      setTab("file");
    } catch (error) {
      if (fileContentGate.isCurrent(request))
        setNotice(error instanceof Error ? error.message : String(error));
    }
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
        selectedRef.current = null;
        setSelected(null);
        resetSessionView();
      }
      await loadSessions();
      setDeleteTarget(null);
      setNotice(`Deleted chat “${sessionTitle(target)}”`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setDeletingSessionId("");
    }
  }

  const currentNoticeTone = notice ? noticeTone(notice) : "info";

  return (
    <div className={`app ${sidebarHidden ? "sidebar-hidden" : ""}`}>
      <Sidebar
        cwd={cwd}
        sessions={sessions}
        selected={selected}
        deletingSessionId={deletingSessionId}
        files={files}
        filePath={filePath}
        activeFilePath={file?.path ?? ""}
        onNewSession={() =>
          void newSession().catch((error) =>
            setNotice(error instanceof Error ? error.message : String(error)),
          )
        }
        creatingSession={creatingSession}
        onHide={() => setSidebarHidden(true)}
        permissionProfile={permissionProfile}
        onPermissionProfile={(profile) => {
          setPermissionProfile(profile);
          void api("/api/permissions", {
            method: "POST",
            body: JSON.stringify({ profile }),
          });
        }}
        onSelectSession={(session) => {
          resetSessionView();
          selectedRef.current = session;
          setSelected(session);
          if (isMobileLayout(window.innerWidth)) setSidebarHidden(true);
        }}
        onSelectSearchResult={(session, messageIndex) => {
          resetSessionView();
          selectedRef.current = session;
          setSelected(session);
          setLocateMessage(messageIndex);
          if (isMobileLayout(window.innerWidth)) setSidebarHidden(true);
        }}
        onDeleteSession={requestSessionDelete}
        onFilePath={setFilePath}
        onOpenFile={(entry) => {
          void openFile(entry);
          if (entry.type === "file" && isMobileLayout(window.innerWidth))
            setSidebarHidden(true);
        }}
      />

      <main className="main">
        <AppNavigation
          tab={tab}
          running={running}
          sidebarHidden={sidebarHidden}
          hasFile={Boolean(file)}
          onTab={setTab}
          onToggleSidebar={() => setSidebarHidden((value) => !value)}
        />
        {notice && (
          <div
            className={`notice ${currentNoticeTone}`}
            role={currentNoticeTone === "danger" ? "alert" : "status"}
          >
            <span className="notice-icon" aria-hidden="true">
              {noticeIcon(currentNoticeTone)}
            </span>
            <strong>{notice}</strong>
            {notice.includes("Diagnostics") && (
              <button
                type="button"
                onClick={() => {
                  setTab("settings");
                  setNotice("");
                }}
              >
                Open diagnostics
              </button>
            )}
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
            sessionId={selectedId}
            cwd={activeCwd}
            onOpenDiff={() => setTab("diff")}
            onOpenValidation={() => setTab("validation")}
            onSend={sendPrompt}
            onAbort={abortAgent}
            lastValidation={lastValidation}
            locateMessage={locateMessage}
            onLocated={() => setLocateMessage(null)}
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
            composerIntents={composerIntents}
            onComposerIntentsConsumed={consumeComposerIntents}
          />
        )}
        {tab === "terminal" && (
          <TerminalPane cwd={activeCwd} theme={resolvedTheme(theme)} />
        )}
        {tab === "diff" && (
          <DiffPane
            cwd={activeCwd}
            sessionId={selectedId}
            onNotice={setNotice}
          />
        )}
        {tab === "validation" && (
          <ValidationPanel
            cwd={activeCwd}
            onNotice={setNotice}
            onResult={setLastValidation}
          />
        )}
        {tab === "preview" && <PreviewPane onNotice={setNotice} />}
        {tab === "workbench" && (
          <WorkbenchPane
            cwd={activeCwd}
            sessionId={selectedId}
            sessions={sessions}
            onNotice={setNotice}
            onOpenDiff={() => setTab("diff")}
            onOpenValidation={() => setTab("validation")}
          />
        )}
        {tab === "evaluation" && <EvaluationPane onNotice={setNotice} />}
        {tab === "replay" && <ReplayPane />}
        {tab === "settings" && (
          <ControlRoom
            cwd={activeCwd}
            selected={selected}
            status={status}
            models={models}
            tools={tools}
            usageHistory={usageHistory}
            permissionProfile={permissionProfile}
            onPermissionProfile={setPermissionProfile}
            theme={theme}
            onTheme={setTheme}
            onModel={setModel}
            onTools={saveTools}
            onDeleteSession={requestSessionDelete}
            onNotice={setNotice}
            onSessionsChanged={async () => {
              eventsRef.current?.close();
              eventsRef.current = null;
              selectedRef.current = null;
              setSelected(null);
              resetSessionView();
              await loadSessions();
            }}
            onAuthChanged={loadModels}
            onRulesSaved={async () => {
              await loadCommands(selectedId);
              await loadTools(selectedId);
            }}
          />
        )}
        {tab === "file" && <FilePane file={file} />}
      </main>
      {helpOpen && (
        <section
          className="help-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Keyboard shortcuts"
        >
          <h2>Keyboard shortcuts</h2>
          <input
            className="input"
            value={helpQuery}
            onChange={(event) => setHelpQuery(event.target.value)}
            placeholder="Search shortcuts and commands"
          />
          <dl>
            {shortcutHelp
              .filter(
                ([keys, label]) =>
                  !helpQuery.trim() ||
                  `${keys} ${label}`
                    .toLowerCase()
                    .includes(helpQuery.trim().toLowerCase()),
              )
              .map(([keys, label]) => (
                <div key={keys}>
                  <dt>{keys}</dt>
                  <dd>{label}</dd>
                </div>
              ))}
            {commands
              .filter(
                (cmd) =>
                  helpQuery.trim() &&
                  String(cmd.name ?? "")
                    .toLowerCase()
                    .includes(helpQuery.trim().toLowerCase()),
              )
              .slice(0, 8)
              .map((cmd) => (
                <div key={`cmd-${cmd.name}`}>
                  <dt>/{cmd.name}</dt>
                  <dd>{cmd.description || "Chat command"}</dd>
                </div>
              ))}
          </dl>
          <button type="button" onClick={() => setHelpOpen(false)}>
            Close
          </button>
        </section>
      )}
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
              <div className="panel-title">Delete chat</div>
              <h2 id="delete-session-title">{sessionTitle(deleteTarget)}</h2>
              <p>
                This removes the chat transcript file. The workspace files stay
                untouched.
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
                  : "Delete chat"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
