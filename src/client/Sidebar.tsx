import type { CSSProperties, MouseEvent, PointerEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { createLatestRequestGate } from "./asyncState";
import { isMobileLayout } from "./responsiveLayout";
import { RECENT_CHAT_LIMIT, visibleSidebarSessions } from "./sidebarSessions";
import type { FileEntry, SessionInfo } from "./types";
import { sessionTitle } from "./uiText";

const SIDEBAR_LAYOUT_STORAGE_KEY = "pi-web.sidebar-layout";
const DEFAULT_SIDEBAR_WIDTH = 310;
const SIDEBAR_MIN_WIDTH = 240;
const SIDEBAR_MAX_WIDTH = 620;

type SidebarPane = "sessions" | "files";

type SidebarProps = {
  cwd: string;
  sessions: SessionInfo[];
  selected: SessionInfo | null;
  deletingSessionId: string;
  files: FileEntry[];
  filePath: string;
  activeFilePath: string;
  onNewSession: () => void;
  creatingSession: boolean;
  onHide: () => void;
  permissionProfile: string;
  onPermissionProfile: (value: string) => void;
  onSelectSession: (session: SessionInfo) => void;
  onSelectSearchResult: (session: SessionInfo, messageIndex: number) => void;
  onDeleteSession: (
    session: SessionInfo,
    event?: MouseEvent<HTMLElement>,
  ) => void;
  onFilePath: (path: string) => void;
  onOpenFile: (entry: FileEntry) => void;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function loadSidebarWidth(): number {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(SIDEBAR_LAYOUT_STORAGE_KEY) ?? "{}",
    );
    return clamp(
      Number(parsed.sidebarWidth) || DEFAULT_SIDEBAR_WIDTH,
      SIDEBAR_MIN_WIDTH,
      SIDEBAR_MAX_WIDTH,
    );
  } catch {
    return DEFAULT_SIDEBAR_WIDTH;
  }
}

function workspaceName(path: string): string {
  return path.split("/").filter(Boolean).pop() || path || "Workspace";
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
    if (Math.abs(diffSeconds) >= seconds)
      return formatter.format(Math.round(diffSeconds / seconds), unit);
  }
  return "just now";
}

export function Sidebar({
  cwd,
  sessions,
  selected,
  deletingSessionId,
  files,
  filePath,
  activeFilePath,
  onNewSession,
  creatingSession,
  onHide,
  permissionProfile,
  onPermissionProfile,
  onSelectSession,
  onSelectSearchResult,
  onDeleteSession,
  onFilePath,
  onOpenFile,
}: SidebarProps) {
  const [sidebarWidth, setSidebarWidth] = useState(loadSidebarWidth);
  const [sessionFilter, setSessionFilter] = useState("");
  const [showAllSessions, setShowAllSessions] = useState(false);
  const [messageSearch, setMessageSearch] = useState("");
  const [messageSearchError, setMessageSearchError] = useState("");
  const [messageResults, setMessageResults] = useState<
    Array<{
      sessionId: string;
      excerpt: string;
      role?: string;
      messageIndex?: number;
    }>
  >([]);
  const [pane, setPane] = useState<SidebarPane>("sessions");
  const sidebarRef = useRef<HTMLElement | null>(null);
  const messageSearchGate = useRef(createLatestRequestGate()).current;

  const canStartSession = Boolean(cwd.trim());
  const filteredSessions = useMemo(
    () =>
      visibleSidebarSessions(
        sessions,
        sessionFilter,
        showAllSessions,
        selected?.id,
      ),
    [sessions, sessionFilter, showAllSessions, selected?.id],
  );
  const hasMoreSessions =
    !sessionFilter.trim() &&
    !showAllSessions &&
    sessions.length > RECENT_CHAT_LIMIT;

  useEffect(() => {
    try {
      localStorage.setItem(
        SIDEBAR_LAYOUT_STORAGE_KEY,
        JSON.stringify({ sidebarWidth }),
      );
    } catch {
      // Layout persistence is optional in restricted browser contexts.
    }
  }, [sidebarWidth]);

  useEffect(() => () => messageSearchGate.invalidate(), [messageSearchGate]);

  async function searchMessages() {
    const query = messageSearch.trim();
    const request = messageSearchGate.next();
    setMessageSearchError("");
    if (!query) {
      setMessageResults([]);
      return;
    }
    try {
      const data = await api<{
        results: Array<{
          sessionId: string;
          excerpt: string;
          role?: string;
          messageIndex?: number;
        }>;
      }>(`/api/search/sessions?q=${encodeURIComponent(query)}`);
      if (messageSearchGate.isCurrent(request)) setMessageResults(data.results);
    } catch (error) {
      if (messageSearchGate.isCurrent(request))
        setMessageSearchError(
          error instanceof Error ? error.message : String(error),
        );
    }
  }

  function startSidebarWidthResize(event: PointerEvent<HTMLElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarRef.current?.clientWidth ?? sidebarWidth;
    document.body.classList.add("resizing");
    const onMove = (moveEvent: globalThis.PointerEvent) => {
      setSidebarWidth(
        clamp(
          startWidth + moveEvent.clientX - startX,
          SIDEBAR_MIN_WIDTH,
          SIDEBAR_MAX_WIDTH,
        ),
      );
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

  return (
    <>
      <aside
        id="history-sidebar"
        ref={sidebarRef}
        className="sidebar"
        style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || !isMobileLayout(window.innerWidth))
            return;
          event.preventDefault();
          onHide();
        }}
      >
        <div className="sidebar-header">
          <div className="brand">π web</div>
          <button
            type="button"
            className="sidebar-hide"
            aria-label="Hide history sidebar"
            onClick={onHide}
          >
            Hide
          </button>
        </div>

        <details
          className="panel workspace-panel"
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.open = false;
            event.currentTarget.querySelector<HTMLElement>("summary")?.focus();
          }}
        >
          <summary>
            <span>Workspace</span>
            <small title={cwd}>{workspaceName(cwd)}</small>
          </summary>
          <div className="workspace-settings-body">
            <label className="workspace-input">
              <span className="panel-title">Path</span>
              <input className="input" value={cwd} readOnly />
            </label>
            <label className="workspace-input">
              <span className="panel-title">Permission</span>
              <select
                className="input"
                value={permissionProfile}
                onChange={(event) => onPermissionProfile(event.target.value)}
              >
                <option value="safe">safe</option>
                <option value="full">full</option>
              </select>
            </label>
            <button
              type="button"
              className="layout-reset"
              title="Restore default sidebar width"
              onClick={() => setSidebarWidth(DEFAULT_SIDEBAR_WIDTH)}
            >
              Reset sidebar width
            </button>
          </div>
        </details>

        <button
          type="button"
          className="primary new-session-button"
          disabled={!canStartSession || creatingSession}
          title={
            canStartSession
              ? "Start a new chat in this workspace"
              : "Set a workspace path before starting a chat"
          }
          onClick={onNewSession}
        >
          {creatingSession ? "Starting…" : "New chat"}
        </button>

        <div
          className="sidebar-tab-buttons"
          role="tablist"
          aria-label="Sidebar"
        >
          <button
            type="button"
            role="tab"
            aria-selected={pane === "sessions"}
            className={pane === "sessions" ? "active" : ""}
            onClick={() => setPane("sessions")}
          >
            History <span>{sessions.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={pane === "files"}
            className={pane === "files" ? "active" : ""}
            onClick={() => setPane("files")}
          >
            Files <span className="auto-refresh">auto</span>
          </button>
        </div>

        {pane === "sessions" ? (
          <section className="panel sidebar-tab-panel sessions-panel">
            <input
              className="input sidebar-search"
              value={sessionFilter}
              onChange={(event) => setSessionFilter(event.target.value)}
              placeholder="Find a chat"
            />
            <details
              className="message-search"
              onKeyDown={(event) => {
                if (event.key !== "Escape") return;
                event.preventDefault();
                event.stopPropagation();
                event.currentTarget.open = false;
                event.currentTarget
                  .querySelector<HTMLElement>("summary")
                  ?.focus();
              }}
            >
              <summary>Search all messages</summary>
              <div className="message-search-row">
                <input
                  className="input sidebar-search"
                  value={messageSearch}
                  onChange={(event) => {
                    const value = event.target.value;
                    messageSearchGate.invalidate();
                    setMessageSearch(value);
                    setMessageSearchError("");
                    if (!value.trim()) setMessageResults([]);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void searchMessages();
                  }}
                  placeholder="Search all messages"
                />
                <button type="button" onClick={() => void searchMessages()}>
                  Search
                </button>
              </div>
              {messageSearchError && (
                <div className="empty-small danger">{messageSearchError}</div>
              )}
              {messageResults.length > 0 && (
                <div className="session-list search-results">
                  {messageResults.map((result) => {
                    const session = sessions.find(
                      (item) => item.id === result.sessionId,
                    );
                    return (
                      <button
                        type="button"
                        className="session"
                        key={`${result.sessionId}-${result.messageIndex}-${result.excerpt}`}
                        disabled={!session || creatingSession}
                        onClick={() =>
                          session &&
                          onSelectSearchResult(
                            session,
                            result.messageIndex ?? 0,
                          )
                        }
                      >
                        <span className="session-heading">
                          <span>{result.role ?? "message"}</span>
                        </span>
                        <small>{result.excerpt}</small>
                      </button>
                    );
                  })}
                </div>
              )}
            </details>
            <div className="session-list">
              {filteredSessions.map((session) => {
                const title = sessionTitle(session);
                const deleting = deletingSessionId === session.id;
                const active = selected?.id === session.id;
                return (
                  <div
                    key={session.id}
                    className={`session-row ${active ? "active" : ""}`}
                  >
                    <button
                      type="button"
                      className={`session ${active ? "active" : ""}`}
                      disabled={deleting || creatingSession}
                      onClick={() => onSelectSession(session)}
                    >
                      <span className="session-heading">
                        <span>{title}</span>
                        {session.cwd.includes("/worktrees/") && (
                          <em>worktree</em>
                        )}
                        {active && <em>active</em>}
                      </span>
                      <span className="session-meta">
                        <span title={session.cwd}>
                          {workspaceName(session.cwd)}
                        </span>
                        <span
                          title={`${formatRelativeTime(session.modified)} · ${session.messageCount} messages`}
                        >
                          {formatRelativeTime(session.modified)} ·{" "}
                          {session.messageCount} msgs
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="session-delete"
                      aria-label={`Delete ${title}`}
                      title="Delete chat"
                      disabled={deleting}
                      onClick={(event) => onDeleteSession(session, event)}
                    >
                      {deleting ? "…" : "×"}
                    </button>
                  </div>
                );
              })}
              {hasMoreSessions && (
                <button
                  type="button"
                  className="show-all-sessions"
                  onClick={() => setShowAllSessions(true)}
                >
                  Show all {sessions.length} chats
                </button>
              )}
              {showAllSessions &&
                !sessionFilter.trim() &&
                sessions.length > RECENT_CHAT_LIMIT && (
                  <button
                    type="button"
                    className="show-all-sessions"
                    onClick={() => setShowAllSessions(false)}
                  >
                    Show recent chats
                  </button>
                )}
              {filteredSessions.length === 0 && (
                <div className="empty-small">
                  {sessionFilter.trim()
                    ? "No matching chats."
                    : "No chats yet."}
                </div>
              )}
            </div>
          </section>
        ) : (
          <section className="panel sidebar-tab-panel files">
            <div className="panel-title">
              <span>Files</span>
              <span className="file-panel-actions">
                <span>{files.length} items</span>
                {filePath && (
                  <button
                    type="button"
                    className="link"
                    onClick={() =>
                      onFilePath(filePath.split("/").slice(0, -1).join("/"))
                    }
                  >
                    up
                  </button>
                )}
              </span>
            </div>
            <div className="file-path" title={filePath || "."}>
              {filePath || "."}
            </div>
            <div className="file-list">
              {files.map((entry) => {
                const activeFile = entry.path === activeFilePath;
                return (
                  <button
                    type="button"
                    key={entry.path}
                    className={`file-row ${entry.type} ${activeFile ? "active" : ""}`}
                    aria-current={activeFile ? "page" : undefined}
                    title={entry.path}
                    onClick={() => onOpenFile(entry)}
                  >
                    <span className="file-row-icon" aria-hidden="true">
                      {entry.type === "directory" ? "▸" : "•"}
                    </span>
                    <span className="file-row-name">{entry.name}</span>
                  </button>
                );
              })}
            </div>
          </section>
        )}
      </aside>
      <button
        type="button"
        className="sidebar-width-resizer"
        aria-label="Resize history sidebar"
        onPointerDown={startSidebarWidthResize}
      />
      <button
        type="button"
        className="sidebar-backdrop"
        aria-label="Close history sidebar"
        onClick={onHide}
      />
    </>
  );
}
