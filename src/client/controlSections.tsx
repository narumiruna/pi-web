import type { Theme } from "./types";
import { Button, SelectField, TextArea } from "./ui";
import type { UsageSnapshot } from "./usage";

export type JsonObject = Record<string, unknown>;
export type DashboardValue =
  | JsonObject
  | unknown[]
  | string
  | number
  | boolean
  | null
  | undefined;

export const object = (value: DashboardValue) =>
  value && !Array.isArray(value) && typeof value === "object"
    ? (value as JsonObject)
    : undefined;
export const field = (value: DashboardValue, key: string) =>
  object(value)?.[key] as DashboardValue;
export const arrayField = (
  value: DashboardValue,
  key: string,
): DashboardValue[] =>
  Array.isArray(field(value, key))
    ? (field(value, key) as DashboardValue[])
    : [];
export const textField = (value: DashboardValue, key: string) => {
  const result = field(value, key);
  return typeof result === "string" ? result : undefined;
};
export const boolField = (value: DashboardValue, key: string) =>
  field(value, key) === true;
export const count = (items: unknown[], label: string) =>
  `${items.length} ${label}${items.length === 1 ? "" : "s"}`;
export const shortTime = (value?: string) =>
  value ? new Date(value).toLocaleString() : "unknown";

export const themeNames: Record<Theme, string> = {
  system: "System",
  dark: "Dark",
  light: "Light",
};
export const themeDetails: Record<Theme, string> = {
  system: "Follow device setting",
  dark: "High-contrast dark workspace",
  light: "Bright workspace for daylight",
};
export const themeOptions: Theme[] = ["system", "dark", "light"];

export function routeProjectId(cwd: string) {
  let binary = "";
  for (const byte of new TextEncoder().encode(cwd))
    binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

export function pathBaseName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

export function UsageSection({
  usageHistory,
}: {
  usageHistory: UsageSnapshot[];
}) {
  const usage = usageHistory.at(-1);
  const usageTrend = usageHistory.slice(-10).map((snapshot, index, window) => ({
    sample: usageHistory.length - window.length + index + 1,
    ...snapshot,
  }));
  return (
    <div className="settings-page">
      <div className="section-head">
        <div>
          <div className="panel-title">Usage</div>
          <h2>Token / cost dashboard</h2>
          <p>Provider/SDK reported estimates; missing values show as zero.</p>
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
      {usageHistory.length > 1 && (
        <table className="usage-trend">
          <thead>
            <tr>
              <th>Sample</th>
              <th>Input</th>
              <th>Output</th>
              <th>Cost</th>
              <th>Context</th>
            </tr>
          </thead>
          <tbody>
            {usageTrend.map((row) => (
              <tr key={row.sample}>
                <td>#{row.sample}</td>
                <td>{row.inputTokens}</td>
                <td>{row.outputTokens}</td>
                <td>${row.cost.toFixed(4)}</td>
                <td>{row.contextPercent}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function DiagnosticsSection({
  items,
  onRefresh,
}: {
  items: DashboardValue[];
  onRefresh: () => void;
}) {
  return (
    <div className="settings-page">
      <div className="section-head">
        <div>
          <div className="panel-title">Diagnostics</div>
          <h2>Onboarding checks</h2>
          <p>
            Actionable checks for runtime, auth, model setup, cwd, and shell.
            Failures sort to the top.
          </p>
        </div>
        <Button type="button" onClick={onRefresh}>
          Refresh
        </Button>
      </div>
      <div className="compact-list">
        {items.map((item) => (
          <div
            className={`compact-row ${textField(item, "status")}`}
            key={textField(item, "name")}
          >
            <strong>{textField(item, "name")}</strong>
            <span>{textField(item, "detail")}</span>
            {textField(item, "fix") && <small>{textField(item, "fix")}</small>}
          </div>
        ))}
      </div>
    </div>
  );
}

export function RulesSection({
  files,
  editingPath,
  editingContent,
  onEdit,
  onRestore,
  onChangeContent,
  onSave,
  onCancel,
}: {
  files: DashboardValue[];
  editingPath: string;
  editingContent: string;
  onEdit: (path: string) => void;
  onRestore: (path: string) => void;
  onChangeContent: (content: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="settings-page">
      <div className="section-head">
        <div>
          <div className="panel-title">Rules</div>
          <h2>Repo instructions / skills / rules</h2>
          <p>Only AGENTS.md, CLAUDE.md, and .pi paths are editable.</p>
        </div>
      </div>
      <div className="compact-list">
        {files.map((file) => {
          const path = textField(file, "path") ?? "AGENTS.md";
          const warnings = arrayField(file, "warnings").map(String);
          return (
            <div className="compact-row" key={path}>
              <strong>{path}</strong>
              <span>
                {boolField(file, "exists")
                  ? `modified ${shortTime(textField(file, "modified"))}`
                  : "missing"}
                {warnings.length > 0 && ` · ${warnings.join("; ")}`}
              </span>
              <div className="row-actions">
                <Button type="button" onClick={() => onEdit(path)}>
                  Edit
                </Button>
                <Button type="button" onClick={() => onRestore(path)}>
                  Restore backup
                </Button>
              </div>
            </div>
          );
        })}
      </div>
      {editingPath && (
        <div className="rules-editor">
          <div className="panel-title">Editing {editingPath}</div>
          <TextArea
            value={editingContent}
            rows={16}
            aria-label={`Edit ${editingPath}`}
            onChange={(event) => onChangeContent(event.target.value)}
          />
          <div className="row-actions">
            <Button type="button" className="primary" onClick={onSave}>
              Save
            </Button>
            <Button type="button" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function McpSection({
  servers,
  testOutput,
  onAdd,
  onRestoreBackup,
  onToggle,
  onTest,
  onRemove,
}: {
  servers: Record<string, unknown>;
  testOutput: string;
  onAdd: () => void;
  onRestoreBackup: () => void;
  onToggle: (name: string, server: JsonObject) => void;
  onTest: (name: string, server: JsonObject) => void;
  onRemove: (name: string) => void;
}) {
  return (
    <div className="settings-page">
      <div className="section-head">
        <div>
          <div className="panel-title">MCP / external tools</div>
          <h2>{Object.keys(servers).length} stdio servers</h2>
          <p>
            Pi has no built-in MCP; pi-web stores config for extension-backed
            tool launchers. Tools started from a server appear in the session
            tools list under extension scope.
          </p>
        </div>
        <div className="hero-actions">
          <Button type="button" onClick={onAdd}>
            Add stdio server
          </Button>
          <Button type="button" onClick={onRestoreBackup}>
            Restore last backup
          </Button>
        </div>
      </div>
      <div className="compact-list">
        {Object.entries(servers).map(([name, value]) => {
          const server = (value ?? {}) as JsonObject;
          const enabled = server.enabled !== false;
          return (
            <div className="compact-row" key={name}>
              <strong>{name}</strong>
              <span>
                {String(server.command ?? "no command")} ·{" "}
                <span className={`state-badge ${enabled ? "ok" : "muted"}`}>
                  {enabled ? "enabled" : "disabled"}
                </span>
              </span>
              <div className="row-actions">
                <Button type="button" onClick={() => onToggle(name, server)}>
                  {enabled ? "Disable" : "Enable"}
                </Button>
                <Button type="button" onClick={() => onTest(name, server)}>
                  Test
                </Button>
                <Button
                  type="button"
                  className="danger"
                  onClick={() => onRemove(name)}
                >
                  Remove
                </Button>
              </div>
            </div>
          );
        })}
        {Object.keys(servers).length === 0 && (
          <div className="empty-small">No MCP servers configured.</div>
        )}
      </div>
      {testOutput && <pre className="diff-output">{testOutput}</pre>}
    </div>
  );
}

export function BookmarksSection({
  bookmarks,
}: {
  bookmarks: DashboardValue[];
}) {
  return (
    <div className="settings-page">
      <div className="section-head">
        <div>
          <div className="panel-title">Bookmarks</div>
          <h2>{bookmarks.length} saved messages</h2>
          <p>
            Bookmarks live in pi-web metadata, not session transcript files.
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
  );
}

export function AppearanceSection({
  theme,
  onTheme,
  onNotice,
}: {
  theme: Theme;
  onTheme: (theme: Theme) => void;
  onNotice: (message: string) => void;
}) {
  return (
    <div className="settings-page">
      <div className="section-head">
        <div>
          <div className="panel-title">Appearance</div>
          <h2>
            {themeNames[theme]}
            <span className="scope-badge">Applies to: This browser</span>
          </h2>
          <p>{themeDetails[theme]}</p>
        </div>
        <SelectField
          ariaLabel="Theme"
          value={theme}
          onValueChange={(value) => {
            const next = value as Theme;
            onTheme(next);
            onNotice(`Theme changed to ${themeNames[next]}`);
          }}
          options={themeOptions.map((option) => ({
            value: option,
            label: themeNames[option],
          }))}
        />
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
  );
}
