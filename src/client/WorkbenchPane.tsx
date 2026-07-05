import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import type { SessionInfo } from "./types";

type Task = {
  id: string;
  title: string;
  status: string;
  sessionId?: string;
  cwd?: string;
};
const STATUSES = ["todo", "doing", "review", "done"];

function draft(text: string) {
  window.dispatchEvent(new CustomEvent("pi-web:draft", { detail: text }));
}

export function WorkbenchPane({
  cwd,
  sessionId,
  sessions,
  onNotice,
  onOpenDiff,
  onOpenValidation,
  onOpenWorktreeSession,
}: {
  cwd: string;
  sessionId?: string;
  sessions: SessionInfo[];
  onNotice: (message: string) => void;
  onOpenDiff: () => void;
  onOpenValidation: () => void;
  onOpenWorktreeSession: (title: string) => Promise<void>;
}) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState("");
  const [issue, setIssue] = useState("");
  const [issueWorktree, setIssueWorktree] = useState(false);

  const refresh = useCallback(async () => {
    const data = await api<{ tasks: Task[] }>("/api/tasks");
    setTasks(data.tasks);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function save(task: Partial<Task>) {
    await api(task.id ? `/api/tasks/${task.id}` : "/api/tasks", {
      method: task.id ? "PATCH" : "POST",
      body: JSON.stringify({ title, cwd, sessionId, ...task }),
    });
    setTitle("");
    await refresh();
  }

  async function importIssue() {
    const payload = await api<{
      prompt: string;
      title: string;
      fallback?: boolean;
      error?: string;
    }>("/api/issues/import", {
      method: "POST",
      body: JSON.stringify({ cwd, issue }),
    });
    draft(payload.prompt);
    await save({ title: payload.title, status: "todo" });
    setTitle(payload.title);
    if (payload.fallback) {
      onNotice(
        `gh unavailable (${payload.error ?? "not installed"}); created prompt draft and task card only`,
      );
      return;
    }
    if (issueWorktree) {
      await onOpenWorktreeSession(payload.title);
      onNotice("Issue imported; worktree session created");
      return;
    }
    onNotice("Issue imported to chat draft");
  }

  async function removeCurrentWorktree() {
    const result = await api<{ removed?: boolean; dirty?: boolean }>(
      "/api/worktrees",
      {
        method: "DELETE",
        body: JSON.stringify({ cwd, path: cwd }),
      },
    );
    onNotice(
      result.dirty ? "Worktree has uncommitted changes" : "Worktree removed",
    );
  }

  async function createPr() {
    const result = await api<{ url?: string }>("/api/pr/create", {
      method: "POST",
      body: JSON.stringify({
        cwd,
        title: title || undefined,
        summary: "Implemented roadmap tasks.",
        testing: "npm run ci",
      }),
    });
    onNotice(result.url || "Draft PR created");
  }

  function sessionMissing(task: Task) {
    return Boolean(
      task.sessionId &&
        !sessions.some((session) => session.id === task.sessionId),
    );
  }

  return (
    <div className="tool-pane workbench-pane">
      <section className="panel">
        <div className="section-head">
          <div>
            <div className="panel-title">Task workbench</div>
            <h2>Kanban tasks, issue import, draft PR</h2>
            <p>Tasks are local metadata and do not modify session files.</p>
          </div>
        </div>
        <div className="hero-actions">
          <input
            className="input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Task title"
          />
          <button type="button" onClick={() => void save({ status: "todo" })}>
            Add task
          </button>
          <input
            className="input"
            value={issue}
            onChange={(event) => setIssue(event.target.value)}
            placeholder="GitHub issue URL or #"
          />
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={issueWorktree}
              onChange={(event) => setIssueWorktree(event.target.checked)}
            />
            Worktree session
          </label>
          <button type="button" onClick={() => void importIssue()}>
            Import issue
          </button>
          <button type="button" onClick={() => void createPr()}>
            Create draft PR
          </button>
          {cwd.includes("/worktrees/") && (
            <button
              type="button"
              className="danger"
              onClick={() => void removeCurrentWorktree()}
            >
              Remove worktree
            </button>
          )}
        </div>
      </section>
      <div className="kanban-board">
        {STATUSES.map((status) => (
          <section className="panel kanban-column" key={status}>
            <div className="panel-title">{status}</div>
            {tasks
              .filter((task) => task.status === status)
              .map((task) => (
                <article
                  className="task-card"
                  draggable
                  key={task.id}
                  onDragStart={(event) =>
                    event.dataTransfer.setData("text/plain", task.id)
                  }
                >
                  <strong>{task.title}</strong>
                  <small>{task.cwd || cwd}</small>
                  {sessionMissing(task) && (
                    <small className="warning">
                      Linked session no longer exists
                    </small>
                  )}
                  {status === "review" && (
                    <div className="row-actions">
                      <button type="button" onClick={onOpenDiff}>
                        Diff & checkpoints
                      </button>
                      <button type="button" onClick={onOpenValidation}>
                        Validation
                      </button>
                    </div>
                  )}
                  <div className="row-actions">
                    {STATUSES.map(
                      (next) =>
                        next !== status && (
                          <button
                            type="button"
                            key={next}
                            onClick={() => void save({ ...task, status: next })}
                          >
                            {next}
                          </button>
                        ),
                    )}
                  </div>
                </article>
              ))}
            <button
              type="button"
              className="drop-zone"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) =>
                void save({
                  id: event.dataTransfer.getData("text/plain"),
                  status,
                })
              }
            >
              Drop here
            </button>
          </section>
        ))}
      </div>
    </div>
  );
}
