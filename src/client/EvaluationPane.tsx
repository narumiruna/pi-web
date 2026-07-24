import { Checkbox } from "@radix-ui/themes";
import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { Button } from "./ui";

type GoldenTask = { file: string; title: string };
type EvaluationResult = {
  id: string;
  task: string;
  ok: boolean;
  mode?: string;
  durationMs: number;
  cost?: number;
  tokens?: number;
  review?: string;
};

export function EvaluationPane({
  onNotice,
}: {
  onNotice: (message: string) => void;
}) {
  const [tasks, setTasks] = useState<GoldenTask[]>([]);
  const [results, setResults] = useState<EvaluationResult[]>([]);
  const [agentMode, setAgentMode] = useState(false);
  const [runningFile, setRunningFile] = useState("");

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
    setRunningFile(file);
    try {
      const data = await api<{ result: EvaluationResult }>(
        "/api/evaluations/run",
        {
          method: "POST",
          body: JSON.stringify({ file, agent: agentMode }),
        },
      );
      onNotice(`Evaluation ${data.result.ok ? "passed" : "failed"}`);
      await refresh();
    } finally {
      setRunningFile("");
    }
  }

  async function review(id: string, verdict: "accepted" | "rejected") {
    await api(`/api/evaluations/${id}/review`, {
      method: "POST",
      body: JSON.stringify({ review: verdict }),
    });
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
              Dry runs only execute the verification command; agent runs also
              send the prompt to a fresh session and record tokens/cost.
            </p>
          </div>
          <label className="checkbox-row" htmlFor="agent-evaluation-mode">
            <Checkbox
              id="agent-evaluation-mode"
              checked={agentMode}
              onCheckedChange={(checked) => setAgentMode(checked === true)}
            />
            Run with agent (slower, costs tokens)
          </label>
        </div>
        <div className="compact-list">
          {tasks.map((task) => (
            <div className="compact-row" key={task.file}>
              <strong>{task.title}</strong>
              <span>{task.file}</span>
              <Button
                type="button"
                disabled={Boolean(runningFile)}
                onClick={() => void run(task.file)}
              >
                {runningFile === task.file ? "Running…" : "Run"}
              </Button>
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
                {result.ok ? "pass" : "fail"} · {result.mode ?? "dry-run"} ·{" "}
                {result.durationMs}ms · ${result.cost ?? 0} ·{" "}
                {result.tokens ?? 0} tokens
                {result.review ? ` · ${result.review}` : ""}
              </span>
              <div className="row-actions">
                <Button
                  type="button"
                  disabled={result.review === "accepted"}
                  onClick={() => void review(result.id, "accepted")}
                >
                  Accept
                </Button>
                <Button
                  type="button"
                  disabled={result.review === "rejected"}
                  onClick={() => void review(result.id, "rejected")}
                >
                  Reject
                </Button>
                <Button
                  type="button"
                  onClick={() =>
                    navigator.clipboard.writeText(
                      JSON.stringify(result, null, 2),
                    )
                  }
                >
                  Export JSON
                </Button>
              </div>
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
