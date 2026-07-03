import { useState } from "react";
import { api } from "./api";

type JsonObject = Record<string, unknown>;
type DashboardValue =
  | JsonObject
  | unknown[]
  | string
  | number
  | boolean
  | null
  | undefined;

const object = (value: DashboardValue) =>
  value && !Array.isArray(value) && typeof value === "object"
    ? (value as JsonObject)
    : undefined;
const field = (value: DashboardValue, key: string) =>
  object(value)?.[key] as DashboardValue;
const textField = (value: DashboardValue, key: string) => {
  const result = field(value, key);
  return typeof result === "string" ? result : undefined;
};
const boolField = (value: DashboardValue, key: string) =>
  field(value, key) === true;
const stringArrayField = (value: DashboardValue, key: string) => {
  const result = field(value, key);
  return Array.isArray(result)
    ? result.filter((item) => typeof item === "string")
    : [];
};

export const providerId = (provider: DashboardValue) =>
  textField(provider, "id") ?? textField(provider, "provider") ?? "";
export const providerName = (provider: DashboardValue) =>
  textField(provider, "name") ?? providerId(provider);
export const providerConfigured = (provider: DashboardValue) => {
  const auth = field(provider, "auth");
  return boolField(auth, "configured") || Boolean(textField(auth, "source"));
};

function supportsApiKey(provider: DashboardValue) {
  const types = stringArrayField(provider, "authTypes");
  if (types.length) return types.includes("api_key");
  const explicit = field(provider, "supportsApiKey");
  return typeof explicit === "boolean" ? explicit : true;
}

function clearable(provider: DashboardValue) {
  return textField(field(provider, "auth"), "source") === "stored";
}

function statusLabel(provider: DashboardValue) {
  const auth = field(provider, "auth");
  const source = textField(auth, "source");
  if (!providerConfigured(provider)) return "Missing";
  if (source === "environment")
    return `Env: ${textField(auth, "label") ?? "API key"}`;
  if (source === "runtime") return "Runtime";
  if (source === "stored") return "Stored";
  return "Configured";
}

export function AuthSettings({
  providers,
  onChanged,
  onNotice,
}: {
  providers: DashboardValue[];
  onChanged: () => Promise<void>;
  onNotice: (message: string) => void;
}) {
  const [apiKeyInputs, setApiKeyInputs] = useState<Record<string, string>>({});
  const [savingProvider, setSavingProvider] = useState("");

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
      await onChanged();
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
      await onChanged();
      onNotice(`${providerName(provider)} credentials removed`);
    } finally {
      setSavingProvider("");
    }
  }

  if (providers.length === 0)
    return <div className="empty-small">No model providers reported.</div>;

  return (
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
        {providers.map((provider) => {
          const id = providerId(provider);
          const configured = providerConfigured(provider);
          const name = providerName(provider);
          const canSaveKey = supportsApiKey(provider);
          return (
            <tr key={id || name}>
              <th scope="row">{name}</th>
              <td>
                <span
                  className={`status-pill ${configured ? "ok" : "warning"}`}
                >
                  {statusLabel(provider)}
                </span>
              </td>
              <td>
                {canSaveKey ? (
                  <input
                    type="password"
                    placeholder={configured ? "•••••• saved" : "Paste API key"}
                    value={apiKeyInputs[id] ?? ""}
                    onChange={(event) =>
                      setApiKeyInputs((current) => ({
                        ...current,
                        [id]: event.target.value,
                      }))
                    }
                  />
                ) : (
                  <small>
                    API key sign-in is not available for this provider.
                  </small>
                )}
              </td>
              <td>
                <span className="row-actions">
                  {canSaveKey && (
                    <button
                      type="button"
                      disabled={
                        !apiKeyInputs[id]?.trim() || savingProvider === id
                      }
                      onClick={() => void saveApiKey(provider)}
                    >
                      Save
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={!clearable(provider) || savingProvider === id}
                    onClick={() => void clearApiKey(provider)}
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
  );
}
