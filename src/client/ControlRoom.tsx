import { useCallback, useEffect, useState } from "react";

type SessionInfo = { id: string; name?: string; firstMessage: string };
type DashboardValue = Record<string, unknown> | unknown[] | null | undefined;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? res.statusText);
  return json as T;
}

export function ControlRoom({
  cwd,
  selected,
  onNotice,
  onSessionsChanged,
}: {
  cwd: string;
  selected: SessionInfo | null;
  onNotice: (message: string) => void;
  onSessionsChanged: () => Promise<void>;
}) {
  const [data, setData] = useState<Record<string, DashboardValue>>({});
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!cwd) return;
    setLoading(true);
    const read = async (key: string, path: string, init?: RequestInit) => {
      try {
        return [key, await api<DashboardValue>(path, init)];
      } catch (error) {
        return [
          key,
          { error: error instanceof Error ? error.message : String(error) },
        ];
      }
    };
    const projectId = btoa(cwd)
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/, "");
    const entries = await Promise.all([
      read("status", "/api/pi-web/status"),
      read("projects", "/api/projects"),
      read("machines", "/api/machines"),
      read("auth", "/api/auth/providers"),
      read("skills", `/api/skills?cwd=${encodeURIComponent(cwd)}`),
      read("plugins", `/api/plugins?cwd=${encodeURIComponent(cwd)}`),
      read("packages", "/api/pi-packages"),
      read("git", `/api/projects/${projectId}/workspaces/root/git/status`),
    ]);
    setData(Object.fromEntries(entries) as Record<string, DashboardValue>);
    setLoading(false);
  }, [cwd]);

  useEffect(() => void refresh(), [refresh]);

  async function addProject() {
    await api("/api/projects", {
      method: "POST",
      body: JSON.stringify({ path: cwd, name: cwd.split("/").pop() || cwd }),
    });
    await refresh();
    onNotice("Project saved");
  }

  async function renameSession() {
    if (!selected) return;
    const name = prompt("Session name", selected.name || selected.firstMessage);
    if (!name) return;
    await api(`/api/sessions/${selected.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    });
    await onSessionsChanged();
    onNotice("Session renamed");
  }

  async function deleteSession() {
    if (!selected || !confirm("Delete this session file?")) return;
    await api(`/api/sessions/${selected.id}`, { method: "DELETE" });
    await onSessionsChanged();
    onNotice("Session deleted");
  }

  const field = (value: DashboardValue, key: string) =>
    value && !Array.isArray(value) && typeof value === "object"
      ? (value[key] as DashboardValue)
      : undefined;
  const summary = (value: DashboardValue) => {
    if (Array.isArray(value)) return value.length;
    if (!value || typeof value !== "object") return "ready";
    if (value.error) return "error";
    return value.ok !== undefined ? String(value.ok) : "ready";
  };
  const cards = [
    ["Runtime", data.status],
    ["Projects", field(data.projects, "projects")],
    ["Machines", field(data.machines, "machines")],
    ["Auth providers", field(data.auth, "providers")],
    ["Skills", field(data.skills, "skills")],
    ["Pi packages", field(data.packages, "packages")],
    [
      "Plugins",
      field(data.plugins, "packages") ?? field(data.plugins, "plugins"),
    ],
    ["Git", data.git],
  ] as const;

  return (
    <div className="control-room">
      <section className="hero-card">
        <div>
          <p className="eyebrow">third-party parity console</p>
          <h1>Everything in one prettier control room.</h1>
          <p>
            Sessions, branches, files, terminals, projects, machines, auth,
            models, skills, plugins, packages, and git share the same local UI.
          </p>
        </div>
        <div className="hero-actions">
          <button
            type="button"
            className="primary"
            onClick={() => void refresh()}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          <button type="button" onClick={() => void addProject()}>
            Save project
          </button>
        </div>
      </section>
      <div className="metric-grid">
        {cards.map(([title, value]) => (
          <section className="metric-card" key={title}>
            <div className="panel-title">{title}</div>
            <strong>{summary(value)}</strong>
            <pre>
              {(JSON.stringify(value ?? null, null, 2) ?? "null").slice(0, 900)}
            </pre>
          </section>
        ))}
      </div>
      <section className="panel action-panel">
        <div>
          <div className="panel-title">Selected session actions</div>
          <p>
            {selected?.firstMessage || selected?.name || "No session selected"}
          </p>
        </div>
        <div className="hero-actions">
          <button
            type="button"
            disabled={!selected}
            onClick={() => void renameSession()}
          >
            Rename
          </button>
          <button
            type="button"
            disabled={!selected}
            onClick={() =>
              selected &&
              window.open(`/api/sessions/${selected.id}/export`, "_blank")
            }
          >
            Export HTML
          </button>
          <button
            type="button"
            className="danger"
            disabled={!selected}
            onClick={() => void deleteSession()}
          >
            Delete
          </button>
        </div>
      </section>
    </div>
  );
}
