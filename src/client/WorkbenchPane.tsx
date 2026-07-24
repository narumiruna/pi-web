import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { COMPOSER_DRAFT_EVENT } from "./composerIntents";
import type { SessionInfo } from "./types";
import { Button, TextInput } from "./ui";

type Task = {
  id: string;
  title: string;
  status: string;
  sessionId?: string;
  cwd?: string;
};
const STATUSES = ["todo", "doing", "review", "done"];

function draft(text: string) {
  window.dispatchEvent(new CustomEvent(COMPOSER_DRAFT_EVENT, { detail: text }));
}

function isWorktreePath(cwd: string) {
  return /(?:^|[\\/])worktrees(?:[\\/]|$)/.test(cwd);
}

export function WorkbenchPane({
  cwd,
  sessionId,
  sessions,
  onNotice,
  onOpenDiff,
  onOpenValidation,
}: {
  cwd: string;
  sessionId?: string;
  sessions: SessionInfo[];
  onNotice: (message: string) => void;
  onOpenDiff: () => void;
  onOpenValidation: () => void;
}) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState("");
  const [issue, setIssue] = useState("");

  const refresh = useCallback(async () => {
    const data = await api<{ tasks: Task[] }>("/api/tasks");
    setTasks(data.tasks);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function save(task: Partial<Task>) {
    const updating = Boolean(task.id);
    await api(updating ? `/api/tasks/${task.id}` : "/api/tasks", {
      method: updating ? "PATCH" : "POST",
      body: JSON.stringify(
        updating ? task : { title, cwd, sessionId, ...task },
      ),
    });
    if (!updating) setTitle("");
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
          <TextInput
            className="input"
            aria-label="Task title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Task title"
          />
          <Button type="button" onClick={() => void save({ status: "todo" })}>
            Add task
          </Button>
          <TextInput
            className="input"
            aria-label="GitHub issue"
            value={issue}
            onChange={(event) => setIssue(event.target.value)}
            placeholder="GitHub issue URL or #"
          />
          <Button type="button" onClick={() => void importIssue()}>
            Import issue
          </Button>
          <Button type="button" onClick={() => void createPr()}>
            Create draft PR
          </Button>
          {isWorktreePath(cwd) && (
            <Button
              type="button"
              className="danger"
              onClick={() => void removeCurrentWorktree()}
            >
              Remove worktree
            </Button>
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
                      <Button type="button" onClick={onOpenDiff}>
                        Diff & checkpoints
                      </Button>
                      <Button type="button" onClick={onOpenValidation}>
                        Validation
                      </Button>
                    </div>
                  )}
                  <div className="row-actions">
                    {STATUSES.map(
                      (next) =>
                        next !== status && (
                          <Button
                            type="button"
                            key={next}
                            onClick={() => void save({ ...task, status: next })}
                          >
                            {next}
                          </Button>
                        ),
                    )}
                  </div>
                </article>
              ))}
            <Button
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
            </Button>
          </section>
        ))}
      </div>
    </div>
  );
}
