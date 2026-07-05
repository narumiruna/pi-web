import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

type GoldenTask = { file: string; title: string };
type EvaluationResult = {
  id: string;
  task: string;
  ok: boolean;
  durationMs: number;
  cost?: number;
};

export function EvaluationPane({
  onNotice,
}: {
  onNotice: (message: string) => void;
}) {
  const [tasks, setTasks] = useState<GoldenTask[]>([]);
  const [results, setResults] = useState<EvaluationResult[]>([]);

  const refresh = useCallback(async () => {
    const [taskData, resultData] = await Promise.all([
      api<{ tasks: GoldenTask[] }>("/api/golden-tasks"),
      api<{ results: EvaluationResult[] }>("/api/evaluations"),
    ]);
    setTasks(taskData.tasks);
    setResults(resultData.results);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function run(file: string) {
    const data = await api<{ result: EvaluationResult }>(
      "/api/evaluations/run",
      {
        method: "POST",
        body: JSON.stringify({ file }),
      },
    );
    onNotice(`Evaluation ${data.result.ok ? "passed" : "failed"}`);
    await refresh();
  }

  return (
    <div className="tool-pane evaluation-pane">
      <section className="panel">
        <div className="section-head">
          <div>
            <div className="panel-title">Golden tasks</div>
            <h2>Agent quality evaluation</h2>
            <p>
              Runs each task's verification command and records
              pass/fail/cost/time.
            </p>
          </div>
        </div>
        <div className="compact-list">
          {tasks.map((task) => (
            <div className="compact-row" key={task.file}>
              <strong>{task.title}</strong>
              <span>{task.file}</span>
              <button type="button" onClick={() => void run(task.file)}>
                Run
              </button>
            </div>
          ))}
        </div>
      </section>
      <section className="panel">
        <div className="panel-title">Results</div>
        <div className="compact-list">
          {results.map((result) => (
            <div
              className={`compact-row ${result.ok ? "ok" : "warning"}`}
              key={result.id}
            >
              <strong>{result.task}</strong>
              <span>
                {result.ok ? "pass" : "fail"} · {result.durationMs}ms · $
                {result.cost ?? 0}
              </span>
              <button
                type="button"
                onClick={() =>
                  navigator.clipboard.writeText(JSON.stringify(result, null, 2))
                }
              >
                Export JSON
              </button>
            </div>
          ))}
          {results.length === 0 && (
            <div className="empty-small">No evaluation runs yet.</div>
          )}
        </div>
      </section>
    </div>
  );
}
