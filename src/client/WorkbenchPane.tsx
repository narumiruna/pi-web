import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

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
  onNotice,
}: {
  cwd: string;
  sessionId?: string;
  onNotice: (message: string) => void;
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
    await api(task.id ? `/api/tasks/${task.id}` : "/api/tasks", {
      method: task.id ? "PATCH" : "POST",
      body: JSON.stringify({ title, cwd, sessionId, ...task }),
    });
    setTitle("");
    await refresh();
  }

  async function importIssue() {
    const payload = await api<{ prompt: string; title: string }>(
      "/api/issues/import",
      {
        method: "POST",
        body: JSON.stringify({ cwd, issue }),
      },
    );
    draft(payload.prompt);
    setTitle(payload.title);
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
