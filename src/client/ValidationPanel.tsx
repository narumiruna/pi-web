import { useState } from "react";
import { api } from "./api";
import { COMPOSER_DRAFT_EVENT } from "./composerIntents";

const COMMANDS = [
  "npm run lint",
  "npm run typecheck",
  "npm test",
  "npm run build",
  "npm run ci",
];

type ValidationResult = {
  command: string;
  code: number | null;
  output: string;
  ok: boolean;
  finishedAt?: string;
};

function draft(text: string) {
  window.dispatchEvent(new CustomEvent(COMPOSER_DRAFT_EVENT, { detail: text }));
}

export function ValidationPanel({
  cwd,
  onNotice,
  onResult,
}: {
  cwd: string;
  onNotice: (message: string) => void;
  onResult?: (result: ValidationResult) => void;
}) {
  const [running, setRunning] = useState("");
  const [result, setResult] = useState<ValidationResult | null>(null);

  async function run(command: string) {
    setRunning(command);
    try {
      const next = await api<ValidationResult>("/api/validation/run", {
        method: "POST",
        body: JSON.stringify({ cwd, command }),
      });
      setResult(next);
      onResult?.(next);
      onNotice(`${command} exited ${next.code}`);
    } finally {
      setRunning("");
    }
  }

  return (
    <div className="tool-pane validation-pane">
      <section className="panel">
        <div className="section-head">
          <div>
            <div className="panel-title">Validation</div>
            <h2>Lint / typecheck / test / build</h2>
            <p>Only package.json scripts are runnable from this panel.</p>
          </div>
        </div>
        <div className="hero-actions">
          {COMMANDS.map((command) => (
            <button
              type="button"
              key={command}
              disabled={Boolean(running)}
              onClick={() => void run(command)}
            >
              {running === command
                ? "Running…"
                : command.replace("npm run ", "")}
            </button>
          ))}
        </div>
      </section>
      {result && (
        <section className="panel">
          <div className="section-head">
            <div>
              <div className="panel-title">Last result</div>
              <h2>
                {result.ok ? "Passed" : "Failed"} · exit {result.code}
              </h2>
              <p>{result.command}</p>
            </div>
            {!result.ok && (
              <button
                type="button"
                onClick={() =>
                  draft(
                    `Validation failed: ${result.command}\nExit code: ${result.code}\n\n${String(result.output).slice(-4000)}`,
                  )
                }
              >
                Send failure to chat
              </button>
            )}
          </div>
          <pre className="diff-output">{result.output}</pre>
        </section>
      )}
    </div>
  );
}
