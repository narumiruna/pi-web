import { Checkbox, Tabs } from "@radix-ui/themes";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AuthSettings, providerConfigured, providerName } from "./AuthSettings";
import { api } from "./api";
import {
  AppearanceSection,
  arrayField,
  BookmarksSection,
  boolField,
  count,
  type DashboardValue,
  DiagnosticsSection,
  field,
  type JsonObject,
  McpSection,
  object,
  pathBaseName,
  RulesSection,
  routeProjectId,
  shortTime,
  textField,
  themeNames,
  UsageSection,
} from "./controlSections";
import type { ModelInfo, SessionInfo, Theme, ToolInfo } from "./types";
import { Button, SelectField } from "./ui";
import { scopeLabel, sessionTitle, toolRiskLabel } from "./uiText";
import type { UsageSnapshot } from "./usage";

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
  onRulesSaved,
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
  onRulesSaved?: () => Promise<void>;
}) {
  const [data, setData] = useState<LoadedData>({});
  const [loading, setLoading] = useState(false);
  const [section, setSection] = useState<Section>("session");
  const [savingSkill, setSavingSkill] = useState("");
  const [savingTools, setSavingTools] = useState(false);
  const [editingPath, setEditingPath] = useState("");
  const [editingContent, setEditingContent] = useState("");
  const [mcpTestOutput, setMcpTestOutput] = useState("");

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

  async function toggleMcpServer(name: string, server: JsonObject) {
    await api("/api/mcp", {
      method: "POST",
      body: JSON.stringify({
        name,
        server: { ...server, enabled: server.enabled === false },
      }),
    });
    await refresh();
  }

  async function removeMcpServer(name: string) {
    if (!confirm(`Remove MCP server ${name}?`)) return;
    await api("/api/mcp", {
      method: "DELETE",
      body: JSON.stringify({ name }),
    });
    await refresh();
    onNotice(`MCP server ${name} removed (backup written)`);
  }

  async function testMcpServer(name: string, server: JsonObject) {
    const command = typeof server.command === "string" ? server.command : "";
    if (!command) {
      setMcpTestOutput(`${name}: no command configured`);
      return;
    }
    const result = await api<{ ok: boolean; code: number; output: string }>(
      "/api/mcp/test",
      {
        method: "POST",
        body: JSON.stringify({ command, cwd }),
      },
    );
    setMcpTestOutput(
      `${name}: ${result.ok ? "ok" : `exit ${result.code}`}\n${result.output}`.slice(
        0,
        2000,
      ),
    );
  }

  async function restoreMcpBackup() {
    await api("/api/mcp/restore", { method: "POST", body: "{}" });
    await refresh();
    onNotice("MCP config restored from backup");
  }

  async function openInstructionEditor(path: string) {
    const current = await api<{ content: string }>(
      `/api/instructions?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(path)}`,
    ).catch(() => ({ content: "" }));
    setEditingPath(path);
    setEditingContent(current.content);
  }

  async function saveInstruction() {
    if (!editingPath) return;
    await api("/api/instructions", {
      method: "PATCH",
      body: JSON.stringify({ cwd, path: editingPath, content: editingContent }),
    });
    setEditingPath("");
    setEditingContent("");
    await refresh();
    await onRulesSaved?.();
    onNotice(`${editingPath} saved (backup written)`);
  }

  async function restoreInstruction(path: string) {
    await api("/api/instructions", {
      method: "PATCH",
      body: JSON.stringify({ cwd, path, restore: true }),
    });
    await refresh();
    await onRulesSaved?.();
    onNotice(`${path} restored from backup`);
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
          <Button
            type="button"
            className="primary"
            onClick={() => void refresh()}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
      </section>

      <Tabs.Root
        className="settings-layout"
        value={section}
        onValueChange={(value) => setSection(value as Section)}
      >
        <Tabs.List className="settings-nav" aria-label="Control room sections">
          {navItems.map((item) => (
            <Tabs.Trigger
              key={item.key}
              value={item.key}
              className={item.tone ?? ""}
            >
              <span>{item.label}</span>
              <small>{item.meta}</small>
            </Tabs.Trigger>
          ))}
        </Tabs.List>

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
                  <Button
                    type="button"
                    disabled={!selected}
                    onClick={() => void renameSession()}
                  >
                    Rename
                  </Button>
                  {[
                    ["", "HTML"],
                    ["?format=json", "JSON"],
                    ["?format=md", "Markdown"],
                  ].map(([query, label]) => (
                    <Button
                      type="button"
                      key={label}
                      disabled={!selected}
                      onClick={() =>
                        selected &&
                        window.open(
                          `/api/sessions/${selected.id}/export${query}`,
                          "_blank",
                        )
                      }
                    >
                      Export {label}
                    </Button>
                  ))}
                  <Button
                    type="button"
                    className="danger"
                    disabled={!selected}
                    onClick={() => selected && onDeleteSession(selected)}
                  >
                    Delete
                  </Button>
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
                <Button
                  type="button"
                  className="primary"
                  onClick={() => void refresh()}
                >
                  Refresh
                </Button>
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
                <SelectField
                  ariaLabel="Session model"
                  value={currentModelValue}
                  disabled={!selected || models.length === 0}
                  onValueChange={(value) => void onModel(value)}
                  options={[
                    { value: "", label: "auto model" },
                    ...(currentModelValue && !currentModelKnown
                      ? [
                          {
                            value: currentModelValue,
                            label: currentModelValue,
                          },
                        ]
                      : []),
                    ...models.map((item) => ({
                      value: `${item.provider}/${item.id}`,
                      label: `${item.name || item.id} · ${item.provider}`,
                    })),
                  ]}
                />
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
                  <Button
                    type="button"
                    disabled={!selected || tools.length === 0 || savingTools}
                    onClick={() =>
                      void updateTools(tools.map((tool) => tool.name))
                    }
                  >
                    Enable all
                  </Button>
                  <Button
                    type="button"
                    disabled={!selected || tools.length === 0 || savingTools}
                    onClick={() => void updateTools([])}
                  >
                    Disable all
                  </Button>
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
                      htmlFor={`tool-${tool.name}`}
                    >
                      <Checkbox
                        id={`tool-${tool.name}`}
                        disabled={!selected || savingTools}
                        checked={active}
                        onCheckedChange={(checked) => {
                          const next = new Set(activeToolNames);
                          if (checked === true) next.add(tool.name);
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
                      htmlFor={`skill-${filePath ?? name}`}
                    >
                      <Checkbox
                        id={`skill-${filePath ?? name}`}
                        disabled={!filePath || savingSkill === filePath}
                        checked={enabled}
                        onCheckedChange={(checked) =>
                          void setSkillInvocation(skill, checked === true)
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

          {section === "usage" && <UsageSection usageHistory={usageHistory} />}

          {section === "diagnostics" && (
            <DiagnosticsSection
              items={diagnosticItems}
              onRefresh={() => void refresh()}
            />
          )}

          {section === "rules" && (
            <RulesSection
              files={instructionFiles}
              editingPath={editingPath}
              editingContent={editingContent}
              onEdit={(path) => void openInstructionEditor(path)}
              onRestore={(path) => void restoreInstruction(path)}
              onChangeContent={setEditingContent}
              onSave={() => void saveInstruction()}
              onCancel={() => setEditingPath("")}
            />
          )}

          {section === "mcp" && (
            <McpSection
              servers={mcpServers ?? {}}
              testOutput={mcpTestOutput}
              onAdd={() => void addMcpServer()}
              onRestoreBackup={() => void restoreMcpBackup()}
              onToggle={(name, server) => void toggleMcpServer(name, server)}
              onTest={(name, server) => void testMcpServer(name, server)}
              onRemove={(name) => void removeMcpServer(name)}
            />
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
                <SelectField
                  ariaLabel="Permission profile"
                  value={permissionProfile}
                  onValueChange={(value) => void savePermissionProfile(value)}
                  options={[
                    { value: "safe", label: "safe" },
                    { value: "full", label: "full" },
                  ]}
                />
              </div>
              <pre className="diff-output">
                {JSON.stringify(data.permissions ?? {}, null, 2)}
              </pre>
            </div>
          )}

          {section === "bookmarks" && (
            <BookmarksSection bookmarks={bookmarks} />
          )}

          {section === "appearance" && (
            <AppearanceSection
              theme={theme}
              onTheme={onTheme}
              onNotice={onNotice}
            />
          )}
        </section>
      </Tabs.Root>
    </div>
  );
}
