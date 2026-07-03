import { useEffect, useState } from "react";
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

type AuthJobStep =
  | { type: "auth_url"; url: string; instructions?: string }
  | {
      type: "device_code";
      userCode: string;
      verificationUri: string;
      intervalSeconds?: number;
      expiresInSeconds?: number;
    }
  | {
      type: "manual_code";
      message: string;
      placeholder?: string;
      url?: string;
      instructions?: string;
    }
  | {
      type: "prompt";
      message: string;
      placeholder?: string;
      allowEmpty?: boolean;
    }
  | {
      type: "select";
      message: string;
      options: Array<{ id: string; label: string }>;
    }
  | { type: "progress"; message: string }
  | { type: "done"; message: string }
  | { type: "error"; message: string };

type AuthJob = {
  id: string;
  provider: string;
  providerName: string;
  status: "running" | "waiting" | "done" | "error";
  step?: AuthJobStep;
  messages?: string[];
  error?: string;
};

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

function supportsOAuth(provider: DashboardValue) {
  return (
    stringArrayField(provider, "authTypes").includes("oauth") ||
    boolField(provider, "supportsOAuth")
  );
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

function openExternal(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
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
  const [job, setJob] = useState<AuthJob | null>(null);
  const [jobInput, setJobInput] = useState("");

  const jobId = job?.id;
  const jobStatus = job?.status;

  useEffect(() => {
    if (!jobId || jobStatus === "done" || jobStatus === "error") return;
    let stopped = false;
    const refreshJob = async () => {
      try {
        const next = await api<AuthJob>(`/api/auth/login-jobs/${jobId}`);
        if (stopped) return;
        setJob(next);
        if (next.status === "done") {
          onNotice(
            next.step?.type === "done" ? next.step.message : "Logged in",
          );
          await onChanged();
        }
      } catch (error) {
        if (stopped) return;
        const message = error instanceof Error ? error.message : String(error);
        setJob((current) =>
          current?.id === jobId
            ? {
                ...current,
                status: "error",
                error: message,
                step: { type: "error", message },
              }
            : current,
        );
        onNotice(message);
      }
    };
    const timer = window.setInterval(() => void refreshJob(), 1000);
    void refreshJob();
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [jobId, jobStatus, onChanged, onNotice]);

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

  async function startSubscription(provider: DashboardValue) {
    const id = providerId(provider);
    if (!id) return;
    const next = await api<AuthJob>("/api/auth/login-jobs", {
      method: "POST",
      body: JSON.stringify({ provider: id }),
    });
    setJob(next);
    setJobInput("");
    onNotice(`Started ${providerName(provider)} subscription login`);
  }

  async function submitJobInput(value = jobInput) {
    if (!job) return;
    const next = await api<AuthJob>(`/api/auth/login-jobs/${job.id}/input`, {
      method: "POST",
      body: JSON.stringify({ value }),
    });
    setJob(next);
    setJobInput("");
  }

  async function cancelJob() {
    if (!job) return;
    await api(`/api/auth/login-jobs/${job.id}`, { method: "DELETE" });
    setJob(null);
  }

  const loginBusy = Boolean(
    job && job.status !== "done" && job.status !== "error",
  );

  return (
    <>
      {providers.length === 0 ? (
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
                    ) : (
                      <small>Use subscription login</small>
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
                      {supportsOAuth(provider) && (
                        <button
                          type="button"
                          disabled={loginBusy || savingProvider === id}
                          onClick={() => void startSubscription(provider)}
                        >
                          Subscription
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
      )}
      {job && (
        <div className="compact-list">
          <div
            className={`compact-row ${job.status === "error" ? "danger" : "info"}`}
          >
            <span
              className={`status-dot ${job.status === "error" ? "danger" : "info"}`}
            />
            <strong>{job.providerName}</strong>
            <span>
              {renderJobStep(job, jobInput, setJobInput, submitJobInput)}
            </span>
            <span className="row-actions">
              <button
                type="button"
                disabled={!loginBusy}
                onClick={() => void cancelJob()}
              >
                Cancel
              </button>
              {(job.status === "done" || job.status === "error") && (
                <button type="button" onClick={() => setJob(null)}>
                  Close
                </button>
              )}
            </span>
          </div>
        </div>
      )}
    </>
  );
}

function renderJobStep(
  job: AuthJob,
  jobInput: string,
  setJobInput: (value: string) => void,
  submitJobInput: (value?: string) => Promise<void>,
) {
  const step = job.step;
  if (!step) return "Starting login…";
  if (step.type === "auth_url") {
    return (
      <span>
        {step.instructions ?? "Open the login URL."}{" "}
        <button type="button" onClick={() => openExternal(step.url)}>
          Open login
        </button>
      </span>
    );
  }
  if (step.type === "device_code") {
    return (
      <span>
        Enter <strong>{step.userCode}</strong> at {step.verificationUri}{" "}
        <button
          type="button"
          onClick={() => openExternal(step.verificationUri)}
        >
          Open
        </button>
      </span>
    );
  }
  if (step.type === "select") {
    return (
      <span className="row-actions">
        {step.options.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => void submitJobInput(option.id)}
          >
            {option.label}
          </button>
        ))}
      </span>
    );
  }
  if (step.type === "prompt" || step.type === "manual_code") {
    const canSubmit =
      step.type === "prompt" && step.allowEmpty
        ? true
        : Boolean(jobInput.trim());
    return (
      <span className="row-actions">
        {step.type === "manual_code" && step.url && (
          <button type="button" onClick={() => openExternal(step.url)}>
            Open login
          </button>
        )}
        <input
          type="text"
          placeholder={step.placeholder ?? step.message}
          value={jobInput}
          onChange={(event) => setJobInput(event.target.value)}
        />
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => void submitJobInput()}
        >
          Continue
        </button>
        <small>{step.message}</small>
      </span>
    );
  }
  return step.message;
}
