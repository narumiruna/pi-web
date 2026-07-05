import { useCallback, useEffect, useMemo, useState } from "react";
import { AuthSettings, providerConfigured, providerName } from "./AuthSettings";
import { api } from "./api";
import type { ModelInfo, SessionInfo, Theme, ToolInfo } from "./types";
import { scopeLabel, sessionTitle, toolRiskLabel } from "./uiText";
import type { UsageSnapshot } from "./usage";

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
type Section =
  | "session"
  | "git"
  | "model"
  | "tools"
  | "skills"
  | "usage"
  | "diagnostics"
  | "rules"
  | "mcp"
  | "permissions"
  | "bookmarks"
  | "appearance";

type LoadedData = {
  auth?: DashboardValue;
  skills?: DashboardValue;
  git?: DashboardValue;
  diagnostics?: DashboardValue;
  instructions?: DashboardValue;
  mcp?: DashboardValue;
  bookmarks?: DashboardValue;
  permissions?: DashboardValue;
};

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

function routeProjectId(cwd: string) {
  let binary = "";
  for (const byte of new TextEncoder().encode(cwd))
    binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function pathBaseName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

function gitFileMeta(value: string) {
  const rawStatus = value.slice(0, 2);
  const path = value.length > 3 ? value.slice(3).trim() : value.trim();
  const status = rawStatus.trim() || "changed";
  const label = status.includes("?")
    ? "untracked"
    : status.includes("M")
      ? "modified"
      : status.includes("A")
        ? "added"
        : status.includes("D")
          ? "deleted"
          : status.includes("R")
            ? "renamed"
            : "changed";
  return { label, path: path || value, status };
}

export function ControlRoom({
  cwd,
  selected,
  status,
  models,
  tools,
  usageHistory,
  permissionProfile,
  onPermissionProfile,
  theme,
  onTheme,
  onModel,
  onTools,
  onDeleteSession,
  onNotice,
  onSessionsChanged,
  onAuthChanged,
}: {
  cwd: string;
  selected: SessionInfo | null;
  status: StatusSnapshot;
  models: ModelInfo[];
  tools: ToolInfo[];
  usageHistory: UsageSnapshot[];
  permissionProfile: string;
  onPermissionProfile: (profile: string) => void;
  theme: Theme;
  onTheme: (theme: Theme) => void;
  onModel: (value: string) => Promise<void>;
  onTools: (tools: string[]) => Promise<void>;
  onDeleteSession: (session: SessionInfo) => void;
  onNotice: (message: string) => void;
  onSessionsChanged: () => Promise<void>;
  onAuthChanged: () => Promise<void>;
}) {
  const [data, setData] = useState<LoadedData>({});
  const [loading, setLoading] = useState(false);
  const [section, setSection] = useState<Section>("session");
  const [savingSkill, setSavingSkill] = useState("");
  const [savingTools, setSavingTools] = useState(false);

  const refresh = useCallback(async () => {
    if (!cwd) return;
    setLoading(true);
    const read = async (key: keyof LoadedData, path: string) => {
      try {
        return [key, await api<DashboardValue>(path)] as const;
      } catch (error) {
        return [
          key,
          { error: error instanceof Error ? error.message : String(error) },
        ] as const;
      }
    };
    const entries = await Promise.all([
      read("auth", "/api/auth/all-providers"),
      read("skills", `/api/skills?cwd=${encodeURIComponent(cwd)}`),
      read(
        "git",
        `/api/projects/${routeProjectId(cwd)}/workspaces/root/git/status`,
      ),
      read("diagnostics", `/api/diagnostics?cwd=${encodeURIComponent(cwd)}`),
      read("instructions", `/api/instructions?cwd=${encodeURIComponent(cwd)}`),
      read("mcp", "/api/mcp"),
      read("bookmarks", "/api/bookmarks"),
      read("permissions", "/api/permissions"),
    ]);
    setData(Object.fromEntries(entries) as LoadedData);
    setLoading(false);
  }, [cwd]);

  useEffect(() => void refresh(), [refresh]);

  const handleAuthChanged = useCallback(async () => {
    await refresh();
    await onAuthChanged();
  }, [refresh, onAuthChanged]);

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

  async function savePermissionProfile(profile: string) {
    await api("/api/permissions", {
      method: "POST",
      body: JSON.stringify({ profile }),
    });
    onPermissionProfile(profile);
    await refresh();
    onNotice("Permission profile saved");
  }

  async function addMcpServer() {
    const name = prompt("MCP server name");
    const command = prompt("stdio command");
    if (!name || !command) return;
    await api("/api/mcp", {
      method: "POST",
      body: JSON.stringify({
        name,
        server: { type: "stdio", command, enabled: true },
      }),
    });
    await refresh();
    onNotice("MCP server saved");
  }

  async function editInstruction(path: string) {
    const current = await api<{ content: string }>(
      `/api/instructions?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(path)}`,
    );
    const content = prompt(`Edit ${path}`, current.content);
    if (content === null) return;
    await api("/api/instructions", {
      method: "PATCH",
      body: JSON.stringify({ cwd, path, content }),
    });
    await refresh();
    onNotice(`${path} saved`);
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

  const auth = arrayField(data.auth, "providers");
  const skills = arrayField(data.skills, "skills");
  const gitError = textField(data.git, "error");
  const gitFiles = arrayField(data.git, "files").map(String);
  const gitOutput = textField(data.git, "output") ?? "";
  const gitBranch = (textField(data.git, "branch") ?? gitOutput.split("\n")[0])
    .replace(/^##\s*/, "")
    .trim();
  const gitUnavailable =
    Boolean(gitError) ||
    boolField(data.git, "available") === false ||
    gitOutput.includes("ENOENT");
  const gitClean = !gitUnavailable && boolField(data.git, "clean");
  const gitSummary = gitUnavailable
    ? (gitError ?? "Git unavailable")
    : gitClean
      ? "Working tree clean"
      : "Uncommitted changes";
  const gitDetail = gitUnavailable
    ? "Git status could not be read for this workspace."
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
  const configuredProvider = auth.find(providerConfigured);
  const authSummary = configuredProvider
    ? `${providerName(configuredProvider)} configured`
    : "No provider configured";
  const enabledSkills = skills.filter(
    (skill) => !boolField(skill, "disableModelInvocation"),
  );
  const usage = usageHistory.at(-1);
  const diagnosticItems = arrayField(data.diagnostics, "items");
  const instructionFiles = arrayField(data.instructions, "files");
  const mcpServers = object(field(data.mcp, "config"))?.servers as
    | Record<string, unknown>
    | undefined;
  const bookmarks = arrayField(data.bookmarks, "bookmarks");
  const selectedTitle = selected
    ? sessionTitle(selected)
    : "No session selected";

  const navItems: Array<{
    key: Section;
    label: string;
    meta: string;
    tone?: "ok" | "warning" | "muted";
  }> = [
    {
      key: "session",
      label: "Session",
      meta: selected ? "Active" : "Pick one",
    },
    {
      key: "git",
      label: "Git",
      meta: gitClean ? "Clean" : gitUnavailable ? "Unavailable" : "Changes",
      tone: gitClean ? "ok" : "warning",
    },
    { key: "model", label: "Model & API Keys", meta: authSummary },
    { key: "tools", label: "Tools", meta: `${activeToolNames.length} enabled` },
    { key: "skills", label: "Skills", meta: `${enabledSkills.length} enabled` },
    {
      key: "usage",
      label: "Usage",
      meta: usage ? `$${usage.cost.toFixed(4)}` : "—",
    },
    {
      key: "diagnostics",
      label: "Diagnostics",
      meta: `${diagnosticItems.length} checks`,
    },
    { key: "rules", label: "Rules", meta: `${instructionFiles.length} files` },
    {
      key: "mcp",
      label: "MCP",
      meta: `${Object.keys(mcpServers ?? {}).length} servers`,
    },
    { key: "permissions", label: "Permissions", meta: permissionProfile },
    { key: "bookmarks", label: "Bookmarks", meta: `${bookmarks.length}` },
    { key: "appearance", label: "Appearance", meta: themeNames[theme] },
  ];

  return (
    <div className="control-room">
      <section className="dashboard-hero">
        <div>
          <div className="eyebrow">Coding agent workspace</div>
          <h1>Control room</h1>
          <p>Local workspace: {cwd}</p>
        </div>
        <div className="hero-status">
          <span className={`status-pill ${selected ? "ok" : "warning"}`}>
            {selected ? "Session ready" : "No session"}
          </span>
          <span className="status-pill info">{model}</span>
          <button
            type="button"
            className="primary"
            onClick={() => void refresh()}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </section>

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
                  <h2>
                    {selectedTitle}
                    <span className="scope-badge">Applies to: Session</span>
                  </h2>
                  <p>
                    {selected
                      ? `${selected.cwd} · ${selected.messageCount} messages · modified ${shortTime(selected.modified)}`
                      : "Select or create a session before changing model, tools, or exports."}
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
              {!selected && (
                <div className="empty-hint">
                  <span aria-hidden="true">○</span>
                  Pick a session from the sidebar to unlock session controls.
                </div>
              )}
              {selected && (
                <div className="summary-grid">
                  <div>
                    <span>Status</span>
                    <strong>{status?.isStreaming ? "Running" : "Idle"}</strong>
                    <small>{model}</small>
                  </div>
                  <div>
                    <span>Messages</span>
                    <strong>{selected.messageCount}</strong>
                    <small>{shortTime(selected.modified)}</small>
                  </div>
                  <div>
                    <span>Workspace</span>
                    <strong>{pathBaseName(selected.cwd)}</strong>
                    <small>{selected.cwd}</small>
                  </div>
                </div>
              )}
            </div>
          )}

          {section === "git" && (
            <div className="settings-page">
              <div className="section-head">
                <div>
                  <div className="panel-title">Git status</div>
                  <h2>
                    {gitSummary}
                    <span className="scope-badge">Applies to: Workspace</span>
                  </h2>
                  <p>{gitDetail}</p>
                </div>
                <button
                  type="button"
                  className="primary"
                  onClick={() => void refresh()}
                >
                  Refresh
                </button>
              </div>
              {gitFiles.length > 0 ? (
                <div className="compact-list git-file-list">
                  {gitFiles.slice(0, 40).map((file) => {
                    const item = gitFileMeta(file);
                    return (
                      <div key={file} className="compact-row warning git-row">
                        <span className="status-dot warning" />
                        <span className="state-badge warning">
                          {item.label}
                        </span>
                        <strong title={item.path}>{item.path}</strong>
                        <code>{item.status}</code>
                      </div>
                    );
                  })}
                  {gitFiles.length > 40 && (
                    <div className="empty-small">
                      +{gitFiles.length - 40} more files.
                    </div>
                  )}
                </div>
              ) : (
                <div className="empty-small">
                  {gitUnavailable
                    ? "Install git or use an image that includes it."
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
                  <h2>
                    {model}
                    <span className="scope-badge">Model: Session</span>
                    <span className="scope-badge">API keys: Global</span>
                  </h2>
                  <p>
                    {selected
                      ? "Model changes apply to the selected session; API keys are saved globally for this pi-web runtime."
                      : "Select a session to switch models. API keys are saved globally for this pi-web runtime."}
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

              <AuthSettings
                providers={auth}
                onChanged={handleAuthChanged}
                onNotice={onNotice}
              />
            </div>
          )}

          {section === "tools" && (
            <div className="settings-page">
              <div className="section-head">
                <div>
                  <div className="panel-title">Tools</div>
                  <h2>
                    {activeToolNames.length} enabled
                    <span className="scope-badge">Applies to: Session</span>
                  </h2>
                  <p>Toggle the selected session's tool access.</p>
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
                  const risk = toolRiskLabel(tool.name);
                  return (
                    <label
                      className={`compact-row tool-row ${active ? "active" : "disabled"}`}
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
                      <span>
                        <span className="tool-description">
                          {tool.description || "No description"}
                        </span>
                        <span className="tool-labels">
                          <span
                            className={`state-badge ${active ? "ok" : "muted"}`}
                          >
                            {active ? "enabled" : "disabled"}
                          </span>
                          <span className="scope-badge">
                            {scopeLabel(tool.sourceInfo?.scope)} scope
                          </span>
                          {risk && <span className="risk-badge">{risk}</span>}
                        </span>
                      </span>
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
                  <h2>
                    {enabledSkills.length} model-enabled
                    <span className="scope-badge">Applies to: Workspace</span>
                  </h2>
                  <p>
                    Disable model invocation without removing slash-command
                    access.
                  </p>
                </div>
              </div>
              <div className="compact-list">
                {skills.map((skill) => {
                  const filePath = textField(skill, "filePath");
                  const enabled = !boolField(skill, "disableModelInvocation");
                  const name = textField(skill, "name") ?? "Unnamed skill";
                  const description = textField(skill, "description");
                  return (
                    <label
                      className={`compact-row skill-row ${enabled ? "active" : "disabled"}`}
                      key={filePath ?? name}
                      title={description}
                    >
                      <input
                        type="checkbox"
                        disabled={!filePath || savingSkill === filePath}
                        checked={enabled}
                        onChange={(event) =>
                          void setSkillInvocation(skill, event.target.checked)
                        }
                      />
                      <strong>{name}</strong>
                      <span>
                        <span className="tool-description">
                          {description ??
                            (enabled
                              ? "Model can invoke automatically"
                              : "Hidden from model")}
                        </span>
                        <span className="tool-labels">
                          <span
                            className={`state-badge ${enabled ? "ok" : "muted"}`}
                          >
                            {enabled ? "model-enabled" : "slash only"}
                          </span>
                          <span className="scope-badge">
                            {scopeLabel(
                              textField(field(skill, "sourceInfo"), "scope") ??
                                "workspace",
                            )}{" "}
                            scope
                          </span>
                        </span>
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

          {section === "usage" && (
            <div className="settings-page">
              <div className="section-head">
                <div>
                  <div className="panel-title">Usage</div>
                  <h2>Token / cost dashboard</h2>
                  <p>
                    Provider/SDK reported estimates; missing values show as
                    zero.
                  </p>
                </div>
              </div>
              <div className="summary-grid">
                <div>
                  <span>Input</span>
                  <strong>{usage?.inputTokens ?? 0}</strong>
                  <small>tokens</small>
                </div>
                <div>
                  <span>Output</span>
                  <strong>{usage?.outputTokens ?? 0}</strong>
                  <small>tokens</small>
                </div>
                <div>
                  <span>Cost</span>
                  <strong>${(usage?.cost ?? 0).toFixed(4)}</strong>
                  <small>estimated</small>
                </div>
                <div>
                  <span>Context</span>
                  <strong>{usage?.contextPercent ?? 0}%</strong>
                  <small>{usageHistory.length} samples</small>
                </div>
              </div>
            </div>
          )}

          {section === "diagnostics" && (
            <div className="settings-page">
              <div className="section-head">
                <div>
                  <div className="panel-title">Diagnostics</div>
                  <h2>Onboarding checks</h2>
                  <p>
                    Actionable checks for runtime, auth, model setup, cwd, and
                    shell.
                  </p>
                </div>
                <button type="button" onClick={() => void refresh()}>
                  Refresh
                </button>
              </div>
              <div className="compact-list">
                {diagnosticItems.map((item) => (
                  <div
                    className={`compact-row ${textField(item, "status")}`}
                    key={textField(item, "name")}
                  >
                    <strong>{textField(item, "name")}</strong>
                    <span>{textField(item, "detail")}</span>
                    {textField(item, "fix") && (
                      <small>{textField(item, "fix")}</small>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {section === "rules" && (
            <div className="settings-page">
              <div className="section-head">
                <div>
                  <div className="panel-title">Rules</div>
                  <h2>Repo instructions / skills / rules</h2>
                  <p>Only AGENTS.md, CLAUDE.md, and .pi paths are editable.</p>
                </div>
              </div>
              <div className="compact-list">
                {instructionFiles.map((file) => (
                  <div className="compact-row" key={textField(file, "path")}>
                    <strong>{textField(file, "path")}</strong>
                    <span>
                      {boolField(file, "exists") ? "exists" : "missing"}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        void editInstruction(
                          textField(file, "path") ?? "AGENTS.md",
                        )
                      }
                    >
                      Edit
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {section === "mcp" && (
            <div className="settings-page">
              <div className="section-head">
                <div>
                  <div className="panel-title">MCP / external tools</div>
                  <h2>{Object.keys(mcpServers ?? {}).length} stdio servers</h2>
                  <p>
                    Pi has no built-in MCP; pi-web stores config for
                    extension-backed tool launchers.
                  </p>
                </div>
                <button type="button" onClick={() => void addMcpServer()}>
                  Add stdio server
                </button>
              </div>
              <pre className="diff-output">
                {JSON.stringify(mcpServers ?? {}, null, 2)}
              </pre>
            </div>
          )}

          {section === "permissions" && (
            <div className="settings-page">
              <div className="section-head">
                <div>
                  <div className="panel-title">Permissions</div>
                  <h2>Safe mode profile</h2>
                  <p>
                    Pi SDK exposes no approval hook here, so this is
                    profile-only tool limiting for new sessions.
                  </p>
                </div>
                <select
                  value={permissionProfile}
                  onChange={(event) =>
                    void savePermissionProfile(event.target.value)
                  }
                >
                  <option value="safe">safe</option>
                  <option value="ask">ask</option>
                  <option value="full">full</option>
                </select>
              </div>
              <pre className="diff-output">
                {JSON.stringify(data.permissions ?? {}, null, 2)}
              </pre>
            </div>
          )}

          {section === "bookmarks" && (
            <div className="settings-page">
              <div className="section-head">
                <div>
                  <div className="panel-title">Bookmarks</div>
                  <h2>{bookmarks.length} saved messages</h2>
                  <p>
                    Bookmarks live in pi-web metadata, not session transcript
                    files.
                  </p>
                </div>
              </div>
              <div className="compact-list">
                {bookmarks.map((bookmark) => (
                  <div
                    className="compact-row"
                    key={`${textField(bookmark, "sessionId")}-${field(bookmark, "messageIndex") ?? textField(bookmark, "leafId") ?? textField(bookmark, "created") ?? textField(bookmark, "excerpt")}`}
                  >
                    <strong>{textField(bookmark, "role") ?? "message"}</strong>
                    <span>{textField(bookmark, "excerpt")}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {section === "appearance" && (
            <div className="settings-page">
              <div className="section-head">
                <div>
                  <div className="panel-title">Appearance</div>
                  <h2>
                    {themeNames[theme]}
                    <span className="scope-badge">
                      Applies to: This browser
                    </span>
                  </h2>
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
                  <div
                    key={option}
                    className={`theme-card ${option === theme ? "active" : ""}`}
                  >
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
    </div>
  );
}
