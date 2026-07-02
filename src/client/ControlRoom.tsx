import { useCallback, useEffect, useMemo, useState } from "react";
import type { ModelInfo, SessionInfo, ToolInfo } from "./types";

type JsonObject = Record<string, unknown>;
type DashboardValue =
  | JsonObject
  | unknown[]
  | string
  | number
  | boolean
  | null
  | undefined;
type StatusSnapshot = {
  model?: { provider?: string; id?: string };
  isStreaming?: boolean;
} | null;

type Card = {
  key: string;
  title: string;
  summary: string;
  detail: string;
  value: DashboardValue;
  actions?: Array<{ label: string; onClick: () => void }>;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? res.statusText);
  return json as T;
}

const object = (value: DashboardValue) =>
  value && !Array.isArray(value) && typeof value === "object"
    ? (value as JsonObject)
    : undefined;
const field = (value: DashboardValue, key: string) =>
  object(value)?.[key] as DashboardValue;
const arrayField = (value: DashboardValue, key: string): DashboardValue[] =>
  Array.isArray(field(value, key))
    ? (field(value, key) as DashboardValue[])
    : [];
const textField = (value: DashboardValue, key: string) => {
  const result = field(value, key);
  return typeof result === "string" ? result : undefined;
};
const boolField = (value: DashboardValue, key: string) =>
  field(value, key) === true;
const count = (items: unknown[], label: string) =>
  `${items.length} ${label}${items.length === 1 ? "" : "s"}`;
const providerId = (provider: DashboardValue) =>
  textField(provider, "id") ?? textField(provider, "provider") ?? "";
const providerName = (provider: DashboardValue) =>
  textField(provider, "name") ?? providerId(provider);
const providerConfigured = (provider: DashboardValue) =>
  boolField(field(provider, "auth"), "configured");

export function ControlRoom({
  cwd,
  selected,
  status,
  models,
  tools,
  onModel,
  onTools,
  onNotice,
  onSessionsChanged,
}: {
  cwd: string;
  selected: SessionInfo | null;
  status: StatusSnapshot;
  models: ModelInfo[];
  tools: ToolInfo[];
  onModel: (value: string) => Promise<void>;
  onTools: (tools: string[]) => Promise<void>;
  onNotice: (message: string) => void;
  onSessionsChanged: () => Promise<void>;
}) {
  const [data, setData] = useState<Record<string, DashboardValue>>({});
  const [loading, setLoading] = useState(false);
  const [details, setDetails] = useState<Card | null>(null);
  const [apiKeyInputs, setApiKeyInputs] = useState<Record<string, string>>({});
  const [savingProvider, setSavingProvider] = useState("");
  const [savingSkill, setSavingSkill] = useState("");
  const [savingTools, setSavingTools] = useState(false);

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
      read("auth", "/api/auth/all-providers"),
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

  async function saveApiKey(provider: DashboardValue) {
    const id = providerId(provider);
    const key = apiKeyInputs[id]?.trim();
    if (!id || !key) return;
    setSavingProvider(id);
    try {
      await api(`/api/auth/api-key/${encodeURIComponent(id)}`, {
        method: "POST",
        body: JSON.stringify({ key }),
      });
      setApiKeyInputs((value) => ({ ...value, [id]: "" }));
      await refresh();
      onNotice(`${providerName(provider)} API key saved`);
    } finally {
      setSavingProvider("");
    }
  }

  async function clearApiKey(provider: DashboardValue) {
    const id = providerId(provider);
    if (
      !id ||
      !confirm(`Remove saved credentials for ${providerName(provider)}?`)
    )
      return;
    setSavingProvider(id);
    try {
      await api(`/api/auth/api-key/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      await refresh();
      onNotice(`${providerName(provider)} credentials removed`);
    } finally {
      setSavingProvider("");
    }
  }

  async function updateTools(next: string[]) {
    if (!selected) return;
    setSavingTools(true);
    try {
      await onTools(next);
      onNotice("Tools updated");
    } finally {
      setSavingTools(false);
    }
  }

  async function setSkillInvocation(skill: DashboardValue, enabled: boolean) {
    const filePath = textField(skill, "filePath");
    if (!filePath) return;
    setSavingSkill(filePath);
    try {
      await api("/api/skills", {
        method: "PATCH",
        body: JSON.stringify({
          filePath,
          disableModelInvocation: !enabled,
        }),
      });
      await refresh();
      onNotice(
        `${textField(skill, "name") ?? "Skill"} ${enabled ? "enabled" : "hidden"} for model invocation`,
      );
    } finally {
      setSavingSkill("");
    }
  }

  const runtime = data.status;
  const projects = arrayField(data.projects, "projects");
  const machines = arrayField(data.machines, "machines");
  const auth = arrayField(data.auth, "providers");
  const skills = arrayField(data.skills, "skills");
  const packages = arrayField(data.packages, "packages");
  const plugins = arrayField(data.plugins, "packages").length
    ? arrayField(data.plugins, "packages")
    : arrayField(data.plugins, "plugins");
  const gitOutput = textField(data.git, "output") ?? "";
  const gitUnavailable =
    boolField(data.git, "available") === false || gitOutput.includes("ENOENT");
  const model = status?.model
    ? `${status.model.provider}/${status.model.id}`
    : "auto model";
  const activeToolNames = useMemo(
    () => tools.filter((tool) => tool.active).map((tool) => tool.name),
    [tools],
  );
  const currentModelValue = status?.model
    ? `${status.model.provider}/${status.model.id}`
    : "";
  const currentModelKnown = models.some(
    (item) => `${item.provider}/${item.id}` === currentModelValue,
  );
  const authSummary = auth.find(providerConfigured)
    ? `${providerName(auth.find(providerConfigured) as DashboardValue)} configured`
    : "No provider configured";

  const cards: Card[] = [
    {
      key: "runtime",
      title: "Runtime",
      summary: boolField(runtime, "ok")
        ? `Running · ${textField(runtime, "runtime") ?? "local"} · v${textField(runtime, "version") ?? "?"}`
        : "Runtime unavailable",
      detail: `Model: ${model}`,
      value: runtime,
    },
    {
      key: "projects",
      title: "Projects",
      summary: count(projects, "project"),
      detail: cwd,
      value: data.projects,
      actions: [{ label: "Save project", onClick: () => void addProject() }],
    },
    {
      key: "machines",
      title: "Machines",
      summary: machines.some(
        (machine) => textField(machine as DashboardValue, "id") === "local",
      )
        ? "Local connected"
        : count(machines, "machine"),
      detail: "Local web runtime",
      value: data.machines,
    },
    {
      key: "auth",
      title: "Auth",
      summary: authSummary,
      detail: count(auth, "provider"),
      value: data.auth,
    },
    {
      key: "skills",
      title: "Skills",
      summary: skills.some((skill) =>
        (textField(skill as DashboardValue, "name") ?? "")
          .toLowerCase()
          .includes("python"),
      )
        ? "Python available"
        : count(skills, "skill"),
      detail: count(
        skills.filter(
          (skill) =>
            !boolField(skill as DashboardValue, "disableModelInvocation"),
        ),
        "model-enabled skill",
      ),
      value: data.skills,
    },
    {
      key: "plugins",
      title: "Plugins & packages",
      summary: `${plugins.length} plugins · ${packages.length} packages`,
      detail: "Install or disable from package manifests",
      value: { plugins, packages },
    },
    {
      key: "git",
      title: "Git",
      summary: gitUnavailable
        ? "Git unavailable"
        : boolField(data.git, "clean")
          ? "Clean"
          : gitOutput
            ? "Dirty"
            : "Git not available",
      detail: gitUnavailable
        ? "Git executable was not found in this environment."
        : gitOutput.split("\n")[0] || "No git output",
      value: data.git,
      actions: [{ label: "Retry", onClick: () => void refresh() }],
    },
  ];

  return (
    <div className="control-room">
      <section className="hero-card compact-hero">
        <div>
          <h1>Control room</h1>
          <p>Local workspace: {cwd}</p>
          <p>
            Runtime: {cards[0].summary} · Model: {model}
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
        {cards.map((card) => (
          <section className="metric-card" key={card.key}>
            <div className="panel-title">{card.title}</div>
            <strong>{card.summary}</strong>
            <p>{card.detail}</p>
            <div className="card-actions">
              <button type="button" onClick={() => setDetails(card)}>
                View details
              </button>
              {card.actions?.map((action) => (
                <button
                  type="button"
                  key={action.label}
                  onClick={action.onClick}
                >
                  {action.label}
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>

      <section className="panel settings-panel">
        <div>
          <div className="panel-title">Settings</div>
          <p>
            Switch models, store API keys, and decide which tools or skills the
            agent may use.
          </p>
        </div>
        <div className="settings-columns">
          <section className="settings-card">
            <div className="panel-title">Model</div>
            <select
              value={currentModelValue}
              disabled={!selected || models.length === 0}
              onChange={(event) => void onModel(event.target.value)}
            >
              <option value="">auto model</option>
              {currentModelValue && !currentModelKnown && (
                <option value={currentModelValue}>{currentModelValue}</option>
              )}
              {models.map((item) => (
                <option
                  key={`${item.provider}/${item.id}`}
                  value={`${item.provider}/${item.id}`}
                >
                  {item.name || item.id} · {item.provider}
                </option>
              ))}
            </select>
            <small>
              {selected
                ? "Changes apply to the selected session."
                : "Select or create a session to switch models."}
            </small>
          </section>

          <section className="settings-card wide-card">
            <div className="settings-card-head">
              <div className="panel-title">API keys & auth</div>
              <span>{authSummary}</span>
            </div>
            <div className="provider-list">
              {auth.map((provider) => {
                const id = providerId(provider as DashboardValue);
                const configured = providerConfigured(
                  provider as DashboardValue,
                );
                return (
                  <div
                    className="provider-row"
                    key={id || providerName(provider as DashboardValue)}
                  >
                    <div>
                      <strong>
                        {providerName(provider as DashboardValue)}
                      </strong>
                      <small>
                        {configured ? "configured" : "not configured"}
                      </small>
                    </div>
                    <input
                      type="password"
                      placeholder={
                        configured ? "•••••• saved" : "Paste API key"
                      }
                      value={apiKeyInputs[id] ?? ""}
                      onChange={(event) =>
                        setApiKeyInputs((value) => ({
                          ...value,
                          [id]: event.target.value,
                        }))
                      }
                    />
                    <button
                      type="button"
                      disabled={
                        !apiKeyInputs[id]?.trim() || savingProvider === id
                      }
                      onClick={() =>
                        void saveApiKey(provider as DashboardValue)
                      }
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      disabled={!configured || savingProvider === id}
                      onClick={() =>
                        void clearApiKey(provider as DashboardValue)
                      }
                    >
                      Clear
                    </button>
                  </div>
                );
              })}
              {auth.length === 0 && (
                <div className="empty-small">No model providers reported.</div>
              )}
            </div>
          </section>

          <section className="settings-card wide-card">
            <div className="settings-card-head">
              <div className="panel-title">Tools</div>
              <span>{activeToolNames.length} enabled</span>
            </div>
            <div className="setting-actions">
              <button
                type="button"
                disabled={!selected || tools.length === 0 || savingTools}
                onClick={() => void updateTools(tools.map((tool) => tool.name))}
              >
                Enable all
              </button>
              <button
                type="button"
                disabled={!selected || tools.length === 0 || savingTools}
                onClick={() => void updateTools([])}
              >
                Disable all
              </button>
            </div>
            <div className="toggle-list">
              {tools.map((tool) => {
                const active = activeToolNames.includes(tool.name);
                return (
                  <label key={tool.name} title={tool.description}>
                    <input
                      type="checkbox"
                      disabled={!selected || savingTools}
                      checked={active}
                      onChange={(event) => {
                        const next = new Set(activeToolNames);
                        if (event.target.checked) next.add(tool.name);
                        else next.delete(tool.name);
                        void updateTools([...next]);
                      }}
                    />
                    <span>
                      <strong>{tool.name}</strong>
                      {tool.description && <small>{tool.description}</small>}
                    </span>
                  </label>
                );
              })}
              {tools.length === 0 && (
                <div className="empty-small">
                  Select a session to load and configure tools.
                </div>
              )}
            </div>
          </section>

          <section className="settings-card wide-card">
            <div className="settings-card-head">
              <div className="panel-title">Skills</div>
              <span>{skills.length} available</span>
            </div>
            <div className="toggle-list">
              {skills.map((skill) => {
                const value = skill as DashboardValue;
                const filePath = textField(value, "filePath");
                const enabled = !boolField(value, "disableModelInvocation");
                return (
                  <label key={filePath ?? textField(value, "name")}>
                    <input
                      type="checkbox"
                      disabled={!filePath || savingSkill === filePath}
                      checked={enabled}
                      onChange={(event) =>
                        void setSkillInvocation(value, event.target.checked)
                      }
                    />
                    <span>
                      <strong>
                        {textField(value, "name") ?? "Unnamed skill"}
                      </strong>
                      <small>
                        {enabled
                          ? "Model can invoke automatically"
                          : "Hidden from model; slash command still works"}
                      </small>
                      {textField(value, "description") && (
                        <small>{textField(value, "description")}</small>
                      )}
                    </span>
                  </label>
                );
              })}
              {skills.length === 0 && (
                <div className="empty-small">
                  No skills found for this workspace.
                </div>
              )}
            </div>
          </section>
        </div>
      </section>

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

      {details && (
        <div className="details-backdrop">
          <button
            type="button"
            className="details-scrim"
            aria-label="Close details"
            onClick={() => setDetails(null)}
          />
          <aside className="details-drawer">
            <div className="drawer-head">
              <div>
                <div className="panel-title">Details</div>
                <h2>{details.title}</h2>
                <p>{details.summary}</p>
              </div>
              <button type="button" onClick={() => setDetails(null)}>
                Close
              </button>
            </div>
            <pre>{JSON.stringify(details.value ?? null, null, 2)}</pre>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(
                  JSON.stringify(details.value ?? null, null, 2),
                );
                onNotice("Details copied");
              }}
            >
              Copy raw JSON
            </button>
          </aside>
        </div>
      )}
    </div>
  );
}
