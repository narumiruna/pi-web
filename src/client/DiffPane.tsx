import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { splitPatchIntoHunks } from "./diffHunks";

type DiffFile = { status: string; path: string };
type GitDiff = {
  isRepo: boolean;
  files: DiffFile[];
  patch?: string;
  error?: string;
};
type Checkpoint = { id: string; created: string };
type RewindResult = { requiresConfirmation?: boolean; files?: string[] };

export function DiffPane({
  cwd,
  sessionId,
  onNotice,
}: {
  cwd: string;
  sessionId?: string;
  onNotice: (message: string) => void;
}) {
  const [diff, setDiff] = useState<GitDiff | null>(null);
  const [reviewed, setReviewed] = useState<Set<string>>(new Set());
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);

  const refresh = useCallback(async () => {
    const [nextDiff, nextCheckpoints] = await Promise.all([
      api<GitDiff>(`/api/git/diff?cwd=${encodeURIComponent(cwd)}`),
      api<{ checkpoints: Checkpoint[] }>(
        `/api/checkpoints?cwd=${encodeURIComponent(cwd)}${sessionId ? `&sessionId=${encodeURIComponent(sessionId)}` : ""}`,
      ),
    ]);
    setDiff(nextDiff);
    setCheckpoints(nextCheckpoints.checkpoints);
  }, [cwd, sessionId]);

  useEffect(() => {
    if (cwd) void refresh().catch((error) => onNotice(error.message));
  }, [cwd, onNotice, refresh]);

  async function revert(path: string) {
    if (!confirm(`Revert ${path}?`)) return;
    await api("/api/git/revert", {
      method: "POST",
      body: JSON.stringify({ cwd, path }),
    });
    onNotice(`Reverted ${path}`);
    await refresh();
  }

  async function revertHunk(path: string, header: string, patch: string) {
    if (!confirm(`Revert hunk ${header} in ${path}?`)) return;
    await api("/api/git/revert", {
      method: "POST",
      body: JSON.stringify({ cwd, patch }),
    });
    onNotice(`Reverted hunk in ${path}`);
    await refresh();
  }

  async function checkpoint() {
    await api("/api/checkpoints", {
      method: "POST",
      body: JSON.stringify({ cwd, sessionId }),
    });
    onNotice("Checkpoint created");
    await refresh();
  }

  async function rewind(id: string) {
    const result = await api<RewindResult>(`/api/checkpoints/${id}/rewind`, {
      method: "POST",
      body: JSON.stringify({ confirmDelete: false }),
    });
    if (result.requiresConfirmation) {
      if (
        !confirm(
          `Rewind will delete new files:\n${(result.files ?? []).join("\n")}`,
        )
      )
        return;
      await api(`/api/checkpoints/${id}/rewind`, {
        method: "POST",
        body: JSON.stringify({ confirmDelete: true }),
      });
    }
    onNotice("Rewound checkpoint");
    await refresh();
  }

  const files = diff?.files ?? [];
  const hunksByPath = useMemo(() => {
    const map = new Map<string, ReturnType<typeof splitPatchIntoHunks>>();
    for (const hunk of splitPatchIntoHunks(diff?.patch ?? "")) {
      map.set(hunk.path, [...(map.get(hunk.path) ?? []), hunk]);
    }
    return map;
  }, [diff?.patch]);
  return (
    <div className="tool-pane diff-pane">
      <section className="panel">
        <div className="section-head">
          <div>
            <div className="panel-title">Git diff review</div>
            <h2>
              {diff?.isRepo
                ? `${files.length} changed file${files.length === 1 ? "" : "s"}`
                : "Not a git repository"}
            </h2>
            <p>
              Accept marks a file reviewed locally; revert restores the working
              tree file.
            </p>
          </div>
          <div className="hero-actions">
            <button type="button" onClick={() => void refresh()}>
              Refresh
            </button>
            <button type="button" onClick={() => void checkpoint()}>
              Checkpoint
            </button>
          </div>
        </div>
        <div className="compact-list">
          {files.map((file) => {
            const hunks = hunksByPath.get(file.path) ?? [];
            return (
              <div className="compact-row diff-file-row" key={file.path}>
                <strong>
                  {file.status} {file.path}
                </strong>
                <span>{reviewed.has(file.path) ? "reviewed" : "pending"}</span>
                <div className="row-actions">
                  <button
                    type="button"
                    onClick={() =>
                      setReviewed(new Set(reviewed).add(file.path))
                    }
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => void revert(file.path)}
                  >
                    Revert
                  </button>
                </div>
                {hunks.length > 0 && (
                  <details className="hunk-list">
                    <summary>
                      {hunks.length} hunk{hunks.length === 1 ? "" : "s"}
                    </summary>
                    {hunks.map((hunk) => (
                      <div className="hunk-row" key={hunk.header + hunk.path}>
                        <pre>{hunk.patch}</pre>
                        <button
                          type="button"
                          className="danger"
                          onClick={() =>
                            void revertHunk(hunk.path, hunk.header, hunk.patch)
                          }
                        >
                          Revert hunk
                        </button>
                      </div>
                    ))}
                  </details>
                )}
              </div>
            );
          })}
          {files.length === 0 && (
            <div className="empty-small">No working tree changes.</div>
          )}
        </div>
      </section>
      <section className="panel">
        <div className="panel-title">Checkpoints</div>
        <div className="compact-list">
          {checkpoints.map((item) => (
            <div className="compact-row" key={item.id}>
              <strong>{new Date(item.created).toLocaleString()}</strong>
              <span>{item.id}</span>
              <button
                type="button"
                className="danger"
                onClick={() => void rewind(item.id)}
              >
                Rewind
              </button>
            </div>
          ))}
          {checkpoints.length === 0 && (
            <div className="empty-small">No checkpoints yet.</div>
          )}
        </div>
      </section>
      <pre className="diff-output">{diff?.patch || diff?.error || ""}</pre>
    </div>
  );
}
