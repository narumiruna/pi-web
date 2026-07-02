import type { CSSProperties, MouseEvent, PointerEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
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
  onCwd: (value: string) => void;
  onNewSession: () => void;
  onSelectSession: (session: SessionInfo) => void;
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
  onCwd,
  onNewSession,
  onSelectSession,
  onDeleteSession,
  onFilePath,
  onOpenFile,
}: SidebarProps) {
  const [sidebarWidth, setSidebarWidth] = useState(loadSidebarWidth);
  const [sessionFilter, setSessionFilter] = useState("");
  const [pane, setPane] = useState<SidebarPane>("sessions");
  const sidebarRef = useRef<HTMLElement | null>(null);

  const filteredSessions = useMemo(() => {
    const query = sessionFilter.trim().toLowerCase();
    if (!query) return sessions;
    return sessions.filter((session) =>
      [session.name, session.firstMessage, session.cwd]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query)),
    );
  }, [sessions, sessionFilter]);

  useEffect(() => {
    localStorage.setItem(
      SIDEBAR_LAYOUT_STORAGE_KEY,
      JSON.stringify({ sidebarWidth }),
    );
  }, [sidebarWidth]);

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
        ref={sidebarRef}
        className="sidebar"
        style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}
      >
        <div className="sidebar-header">
          <div className="brand">π web</div>
          <button
            type="button"
            className="layout-reset"
            title="Restore default sidebar width"
            onClick={() => setSidebarWidth(DEFAULT_SIDEBAR_WIDTH)}
          >
            Reset layout
          </button>
        </div>

        <section className="panel workspace-panel">
          <label className="workspace-input">
            <span className="panel-title">cwd</span>
            <input
              className="input"
              value={cwd}
              onChange={(event) => onCwd(event.target.value)}
            />
          </label>
          <button type="button" className="primary" onClick={onNewSession}>
            New session
          </button>
        </section>

        <div
          className="sidebar-tab-buttons"
          role="tablist"
          aria-label="Sidebar"
        >
          <button
            type="button"
            role="tab"
            className={pane === "sessions" ? "active" : ""}
            onClick={() => setPane("sessions")}
          >
            Sessions <span>{sessions.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            className={pane === "files" ? "active" : ""}
            onClick={() => setPane("files")}
          >
            Files <span className="auto-refresh">auto</span>
          </button>
        </div>

        {pane === "sessions" ? (
          <section className="panel sidebar-tab-panel sessions-panel">
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
                      disabled={deleting}
                      onClick={() => onSelectSession(session)}
                    >
                      <span className="session-heading">
                        <span>{title}</span>
                        {active && <em>active</em>}
                      </span>
                      <small>{session.cwd}</small>
                      <span className="session-meta">
                        {formatRelativeTime(session.modified)} ·{" "}
                        {session.messageCount} msgs
                      </span>
                    </button>
                    <button
                      type="button"
                      className="session-delete"
                      aria-label={`Delete ${title}`}
                      title="Delete session"
                      disabled={deleting}
                      onClick={(event) => onDeleteSession(session, event)}
                    >
                      {deleting ? "…" : "×"}
                    </button>
                  </div>
                );
              })}
              {filteredSessions.length === 0 && (
                <div className="empty-small">No matching sessions.</div>
              )}
            </div>
          </section>
        ) : (
          <section className="panel sidebar-tab-panel files">
            <div className="panel-title">
              <span>Files</span>
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
            </div>
            <div className="file-path" title={filePath || "."}>
              {filePath || "."}
            </div>
            <div className="file-list">
              {files.map((entry) => (
                <button
                  type="button"
                  key={entry.path}
                  className="file-row"
                  onClick={() => onOpenFile(entry)}
                >
                  <span>{entry.type === "directory" ? "▸" : "•"}</span>{" "}
                  {entry.name}
                </button>
              ))}
            </div>
          </section>
        )}
      </aside>
      <button
        type="button"
        className="sidebar-width-resizer"
        aria-label="Resize sidebar"
        onPointerDown={startSidebarWidthResize}
      />
    </>
  );
}
