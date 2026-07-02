import { useCallback, useEffect, useMemo, useState } from "react";
import type { ModelInfo, SessionInfo, Theme, ToolInfo } from "./types";

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
type Section = "session" | "git" | "model" | "tools" | "skills" | "appearance";
type Tone = "ok" | "warning" | "danger" | "muted";

type Card = {
  key: string;
  title: string;
  summary: string;
  detail: string;
  value: DashboardValue;
  tone?: Tone;
  section?: Section;
  actions?: Array<{ label: string; onClick: () => void }>;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
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
const shortTime = (value?: string) =>
  value ? new Date(value).toLocaleString() : "unknown";
const themeNames: Record<Theme, string> = {
  system: "System",
  dark: "Dark",
  light: "Light",
};
const themeDetails: Record<Theme, string> = {
  system: "Follow device setting",
  dark: "High-contrast dark workspace",
  light: "Bright workspace for daylight",
};
const themeOptions: Theme[] = ["system", "dark", "light"];

export function ControlRoom({
  cwd,
  selected,
  status,
  models,
  tools,
  theme,
  onTheme,
  onModel,
  onTools,
  onDeleteSession,
  onNotice,
  onSessionsChanged,
}: {
  cwd: string;
  selected: SessionInfo | null;
  status: StatusSnapshot;
  models: ModelInfo[];
  tools: ToolInfo[];
  theme: Theme;
  onTheme: (theme: Theme) => void;
  onModel: (value: string) => Promise<void>;
  onTools: (tools: string[]) => Promise<void>;
  onDeleteSession: (session: SessionInfo) => void;
  onNotice: (message: string) => void;
  onSessionsChanged: () => Promise<void>;
}) {
  const [data, setData] = useState<Record<string, DashboardValue>>({});
  const [loading, setLoading] = useState(false);
  const [details, setDetails] = useState<Card | null>(null);
  const [section, setSection] = useState<Section>("session");
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
  const gitFiles = arrayField(data.git, "files").map(String);
  const gitOutput = textField(data.git, "output") ?? "";
  const gitBranch = (textField(data.git, "branch") ?? gitOutput.split("\n")[0])
    .replace(/^##\s*/, "")
    .trim();
  const gitUnavailable =
    boolField(data.git, "available") === false || gitOutput.includes("ENOENT");
  const gitClean = !gitUnavailable && boolField(data.git, "clean");
  const gitTone: Tone = gitUnavailable || !gitClean ? "warning" : "ok";
  const gitSummary = gitUnavailable
    ? "Git unavailable"
    : gitClean
      ? "Working tree clean"
      : "Uncommitted changes";
  const gitDetail = gitUnavailable
    ? "Git executable was not found in this environment."
    : gitClean
      ? gitBranch || "No changes detected"
      : `${gitBranch || "Current branch"} · ${count(gitFiles, "changed file")}`;
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
  const enabledSkills = skills.filter(
    (skill) => !boolField(skill as DashboardValue, "disableModelInvocation"),
  );
  const selectedTitle =
    selected?.name || selected?.firstMessage || "No session selected";

  const cards: Card[] = [
    {
      key: "runtime",
      title: "Runtime",
      summary: boolField(runtime, "ok") ? "Running" : "Unavailable",
      detail: `${textField(runtime, "runtime") ?? "local"} · v${textField(runtime, "version") ?? "?"}`,
      value: runtime,
      tone: boolField(runtime, "ok") ? "ok" : "warning",
      section: "session",
    },
    {
      key: "sessions",
      title: "Session",
      summary: selected ? selectedTitle : "Select a session",
      detail: selected
        ? `${selected.cwd} · ${selected.messageCount} msgs`
        : "Create or pick a session to enable controls",
      value: selected,
      tone: selected ? "ok" : "warning",
      section: "session",
    },
    {
      key: "git",
      title: "Git status",
      summary: gitSummary,
      detail: gitDetail,
      value: data.git,
      tone: gitTone,
      section: "git",
      actions: [{ label: "Refresh", onClick: () => void refresh() }],
    },
    {
      key: "model",
      title: "Model & API Keys",
      summary: model,
      detail: authSummary,
      value: { model: status?.model, auth: data.auth },
      tone: auth.some(providerConfigured) ? "ok" : "warning",
      section: "model",
    },
    {
      key: "tools",
      title: "Tools",
      summary: `${activeToolNames.length}/${tools.length} enabled`,
      detail: selected ? "Session tool access" : "Select a session first",
      value: tools,
      tone: selected ? "ok" : "muted",
      section: "tools",
    },
    {
      key: "skills",
      title: "Skills",
      summary: `${enabledSkills.length}/${skills.length} model-enabled`,
      detail: "Slash commands remain available when hidden from the model",
      value: data.skills,
      tone: skills.length ? "ok" : "muted",
      section: "skills",
    },
    {
      key: "appearance",
      title: "Appearance",
      summary: themeNames[theme],
      detail: themeDetails[theme],
      value: { theme },
      tone: "ok",
      section: "appearance",
    },
    {
      key: "advanced",
      title: "Advanced",
      summary: `${projects.length} projects · ${machines.length} machines`,
      detail: `${plugins.length} plugins · ${packages.length} packages`,
      value: { projects, machines, plugins, packages },
      tone: "muted",
    },
  ];

  const navItems: Array<{
    key: Section;
    label: string;
    meta: string;
    tone?: Tone;
  }> = [
    {
      key: "session",
      label: "Session",
      meta: selected ? "Active" : "Pick one",
    },
    { key: "git", label: "Git", meta: gitSummary, tone: gitTone },
    { key: "model", label: "Model & API Keys", meta: authSummary },
    { key: "tools", label: "Tools", meta: `${activeToolNames.length} enabled` },
    { key: "skills", label: "Skills", meta: `${enabledSkills.length} enabled` },
    { key: "appearance", label: "Appearance", meta: themeNames[theme] },
  ];

  return (
    <div className="control-room product-dashboard">
      <section className="dashboard-hero">
        <div>
          <div className="eyebrow">Coding agent workspace</div>
          <h1>Control room</h1>
          <p>Local workspace: {cwd}</p>
        </div>
        <div className="hero-status">
          <span className="status-pill ok">
            {boolField(runtime, "ok") ? "Online" : "Offline"}
          </span>
          <span className="status-pill">{model}</span>
          <button
            type="button"
            className="primary"
            onClick={() => void refresh()}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </section>

      <div className="metric-grid compact-metrics">
        {cards.map((card) => (
          <section className={`metric-card ${card.tone ?? ""}`} key={card.key}>
            <div className="metric-heading">
              <div className="panel-title">{card.title}</div>
              {card.tone && <span className={`status-dot ${card.tone}`} />}
            </div>
            <strong>{card.summary}</strong>
            <p>{card.detail}</p>
            <div className="card-actions">
              {card.section && (
                <button
                  type="button"
                  onClick={() => card.section && setSection(card.section)}
                >
                  Open
                </button>
              )}
              <button type="button" onClick={() => setDetails(card)}>
                Details
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

      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Control room sections">
          {navItems.map((item) => (
            <button
              type="button"
              key={item.key}
              className={`${section === item.key ? "active" : ""} ${item.tone ?? ""}`}
              onClick={() => setSection(item.key)}
            >
              <span>{item.label}</span>
              <small>{item.meta}</small>
            </button>
          ))}
        </nav>

        <section className="settings-workspace">
          {section === "session" && (
            <div className="settings-page">
              <div className="section-head">
                <div>
                  <div className="panel-title">Session</div>
                  <h2>{selectedTitle}</h2>
                  <p>
                    {selected
                      ? `${selected.cwd} · ${selected.messageCount} messages · modified ${shortTime(selected.modified)}`
                      : "Select or create a session before changing model, tools, or exports."}
                  </p>
                </div>
                <div className="hero-actions">
                  <button type="button" onClick={() => void addProject()}>
                    Save project
                  </button>
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
                      window.open(
                        `/api/sessions/${selected.id}/export`,
                        "_blank",
                      )
                    }
                  >
                    Export HTML
                  </button>
                  <button
                    type="button"
                    className="danger"
                    disabled={!selected}
                    onClick={() => selected && onDeleteSession(selected)}
                  >
                    Delete
                  </button>
                </div>
              </div>
              <div className="summary-grid">
                <div>
                  <span>Runtime</span>
                  <strong>{cards[0].summary}</strong>
                  <small>{cards[0].detail}</small>
                </div>
                <div>
                  <span>Projects</span>
                  <strong>{count(projects, "project")}</strong>
                  <small>{cwd}</small>
                </div>
                <div>
                  <span>Machines</span>
                  <strong>{count(machines, "machine")}</strong>
                  <small>Local web runtime</small>
                </div>
              </div>
            </div>
          )}

          {section === "git" && (
            <div className="settings-page">
              <div className="section-head">
                <div>
                  <div className="panel-title">Git status</div>
                  <h2>{gitSummary}</h2>
                  <p>{gitDetail}</p>
                </div>
                <div className="hero-actions">
                  <button type="button" onClick={() => setDetails(cards[2])}>
                    View changes
                  </button>
                  <button
                    type="button"
                    className="primary"
                    onClick={() => void refresh()}
                  >
                    Refresh
                  </button>
                </div>
              </div>
              {gitFiles.length > 0 ? (
                <div className="compact-list git-file-list">
                  {gitFiles.slice(0, 12).map((file) => (
                    <div key={file} className="compact-row warning">
                      <span className="status-dot warning" />
                      <strong>{file}</strong>
                    </div>
                  ))}
                  {gitFiles.length > 12 && (
                    <div className="empty-small">
                      +{gitFiles.length - 12} more files in details.
                    </div>
                  )}
                </div>
              ) : (
                <div className="empty-small">
                  {gitUnavailable
                    ? "Git is unavailable in this runtime. Install git or use an image that includes it."
                    : "No uncommitted changes reported."}
                </div>
              )}
            </div>
          )}

          {section === "model" && (
            <div className="settings-page">
              <div className="section-head">
                <div>
                  <div className="panel-title">Model & API Keys</div>
                  <h2>{model}</h2>
                  <p>
                    {selected
                      ? "Model changes apply to the selected session."
                      : "Select a session to switch models."}
                  </p>
                </div>
                <select
                  value={currentModelValue}
                  disabled={!selected || models.length === 0}
                  onChange={(event) => void onModel(event.target.value)}
                >
                  <option value="">auto model</option>
                  {currentModelValue && !currentModelKnown && (
                    <option value={currentModelValue}>
                      {currentModelValue}
                    </option>
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
              </div>

              {auth.length === 0 ? (
                <div className="empty-small">No model providers reported.</div>
              ) : (
                <table className="api-key-table">
                  <thead>
                    <tr>
                      <th>Provider</th>
                      <th>Status</th>
                      <th>API Key</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auth.map((provider) => {
                      const value = provider as DashboardValue;
                      const id = providerId(value);
                      const configured = providerConfigured(value);
                      const name = providerName(value);
                      return (
                        <tr key={id || name}>
                          <th scope="row">{name}</th>
                          <td>
                            <span
                              className={`status-pill ${configured ? "ok" : "warning"}`}
                            >
                              {configured ? "Configured" : "Missing"}
                            </span>
                          </td>
                          <td>
                            <input
                              type="password"
                              placeholder={
                                configured ? "•••••• saved" : "Paste API key"
                              }
                              value={apiKeyInputs[id] ?? ""}
                              onChange={(event) =>
                                setApiKeyInputs((current) => ({
                                  ...current,
                                  [id]: event.target.value,
                                }))
                              }
                            />
                          </td>
                          <td>
                            <span className="row-actions">
                              <button
                                type="button"
                                disabled={
                                  !apiKeyInputs[id]?.trim() ||
                                  savingProvider === id
                                }
                                onClick={() => void saveApiKey(value)}
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                disabled={!configured || savingProvider === id}
                                onClick={() => void clearApiKey(value)}
                              >
                                Clear
                              </button>
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {section === "tools" && (
            <div className="settings-page">
              <div className="section-head">
                <div>
                  <div className="panel-title">Tools</div>
                  <h2>{activeToolNames.length} enabled</h2>
                  <p>
                    Keep this list compact; hover rows for full descriptions.
                  </p>
                </div>
                <div className="hero-actions">
                  <button
                    type="button"
                    disabled={!selected || tools.length === 0 || savingTools}
                    onClick={() =>
                      void updateTools(tools.map((tool) => tool.name))
                    }
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
              </div>
              <div className="compact-list">
                {tools.map((tool) => {
                  const active = activeToolNames.includes(tool.name);
                  return (
                    <label
                      className="compact-row"
                      key={tool.name}
                      title={tool.description}
                    >
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
                      <strong>{tool.name}</strong>
                      <span>{tool.description || "No description"}</span>
                    </label>
                  );
                })}
                {tools.length === 0 && (
                  <div className="empty-small">
                    Select a session to load tools.
                  </div>
                )}
              </div>
            </div>
          )}

          {section === "skills" && (
            <div className="settings-page">
              <div className="section-head">
                <div>
                  <div className="panel-title">Skills</div>
                  <h2>{enabledSkills.length} model-enabled</h2>
                  <p>
                    Disable model invocation without removing slash-command
                    access.
                  </p>
                </div>
              </div>
              <div className="compact-list">
                {skills.map((skill) => {
                  const value = skill as DashboardValue;
                  const filePath = textField(value, "filePath");
                  const enabled = !boolField(value, "disableModelInvocation");
                  const name = textField(value, "name") ?? "Unnamed skill";
                  return (
                    <label
                      className="compact-row"
                      key={filePath ?? name}
                      title={textField(value, "description")}
                    >
                      <input
                        type="checkbox"
                        disabled={!filePath || savingSkill === filePath}
                        checked={enabled}
                        onChange={(event) =>
                          void setSkillInvocation(value, event.target.checked)
                        }
                      />
                      <strong>{name}</strong>
                      <span>
                        {enabled
                          ? "Model can invoke automatically"
                          : "Hidden from model"}
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
            </div>
          )}

          {section === "appearance" && (
            <div className="settings-page">
              <div className="section-head">
                <div>
                  <div className="panel-title">Appearance</div>
                  <h2>{themeNames[theme]}</h2>
                  <p>{themeDetails[theme]}</p>
                </div>
                <select
                  value={theme}
                  onChange={(event) => {
                    const next = event.target.value as Theme;
                    onTheme(next);
                    onNotice(`Theme changed to ${themeNames[next]}`);
                  }}
                >
                  {themeOptions.map((option) => (
                    <option key={option} value={option}>
                      {themeNames[option]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="summary-grid">
                {themeOptions.map((option) => (
                  <div key={option}>
                    <span>{option === theme ? "Current" : "Theme"}</span>
                    <strong>{themeNames[option]}</strong>
                    <small>{themeDetails[option]}</small>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>

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
