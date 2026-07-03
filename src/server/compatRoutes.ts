// biome-ignore-all lint: compatibility routes intentionally accept third-party wire shapes.
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import {
  AuthStorage,
  DefaultPackageManager,
  DefaultResourceLoader,
  getAgentDir,
  ModelRegistry,
  parseFrontmatter,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { FastifyInstance } from "fastify";
import {
  listSuggestions,
  registerFileCompatRoutes,
  registerProjectRoutes,
} from "./compatFiles.js";
import { registerSessionCompatRoutes } from "./compatSessions.js";
import {
  configPath,
  errorMessage,
  expandHome,
  writeJson,
} from "./compatShared.js";
import type { CompatDeps as Deps } from "./compatTypes.js";

export function registerCompatRoutes(app: FastifyInstance, deps: Deps) {
  addBinaryParsers(app);
  registerUtilityRoutes(app, deps);
  registerAuthRoutes(app, deps);
  registerSkillRoutes(app);
  registerPackageRoutes(app, deps);
  registerSessionCompatRoutes(app, deps);
  registerFileCompatRoutes(app, deps);
  registerProjectRoutes(app, deps);
  registerMachineRoutes(app);
}

function addBinaryParsers(app: FastifyInstance) {
  for (const contentType of ["text/plain", "application/octet-stream"]) {
    try {
      app.addContentTypeParser(
        contentType,
        { parseAs: contentType === "text/plain" ? "string" : "buffer" },
        (_req, body, done) => {
          done(null, Buffer.isBuffer(body) ? body : Buffer.from(String(body)));
        },
      );
    } catch {
      // parser already registered
    }
  }
}

function registerUtilityRoutes(app: FastifyInstance, deps: Deps) {
  app.get("/api/home", async () => ({ home: homedir() }));
  app.post("/api/default-cwd", async () => ({ cwd: deps.defaultCwd }));
  app.get("/api/pi-web/status", async () => ({
    ok: true,
    runtime: "single-process",
    version: process.env.npm_package_version ?? "0.1.0",
  }));
  app.get("/api/pi-web/version", async () => ({
    current: process.env.npm_package_version ?? "0.1.0",
    latest: null,
    updateAvailable: false,
  }));
  app.get("/api/pi-web/runtime", async () => ({
    mode: "single-process",
    sessionDaemon: false,
    cwd: deps.defaultCwd,
  }));
  app.post<{ Body: { path?: string } }>(
    "/api/cwd/validate",
    async (request, reply) => {
      const input = request.body?.path?.trim();
      if (!input) return reply.code(400).send({ error: "Path is required" });
      const cwd = resolve(expandHome(input));
      try {
        const info = await stat(cwd);
        if (!info.isDirectory())
          return reply.code(400).send({ error: "Path is not a directory" });
        return { success: true, cwd };
      } catch {
        return reply.code(404).send({ error: "Path not found" });
      }
    },
  );
  app.get<{ Querystring: { cwd?: string; q?: string; mode?: string } }>(
    "/api/files",
    async (request, reply) => {
      if (!request.query.cwd)
        return reply
          .code(400)
          .send({ error: "cwd query parameter is required" });
      return listSuggestions(
        resolve(request.query.cwd),
        request.query.q ?? "",
        request.query.mode === "path",
      );
    },
  );
  app.put<{ Body: { config?: unknown } }>("/api/config", async (request) => {
    await writeJson(configPath(), request.body?.config ?? {});
    return { saved: true, config: request.body?.config ?? {} };
  });
}

function registerAuthRoutes(app: FastifyInstance, deps: Deps) {
  app.get("/api/auth/providers", async () => providerResponse(false));
  app.get("/api/auth/all-providers", async () => providerResponse(true));
  app.get<{ Params: { provider: string } }>(
    "/api/auth/api-key/:provider",
    async (request) => {
      const auth = AuthStorage.create();
      return {
        provider: request.params.provider,
        auth: auth.getAuthStatus(request.params.provider),
      };
    },
  );
  app.post<{
    Params: { provider: string };
    Body: { key?: string; env?: Record<string, string> };
  }>("/api/auth/api-key/:provider", async (request, reply) => {
    if (!request.body?.key)
      return reply.code(400).send({ error: "key required" });
    AuthStorage.create().set(request.params.provider, {
      type: "api_key",
      key: request.body.key,
      env: request.body.env,
    });
    refreshLiveAuth(deps);
    return { success: true };
  });
  app.delete<{ Params: { provider: string } }>(
    "/api/auth/api-key/:provider",
    async (request) => {
      AuthStorage.create().remove(request.params.provider);
      refreshLiveAuth(deps);
      return { success: true };
    },
  );
  app.post<{ Body: { provider?: string } }>(
    "/api/auth/login-jobs",
    async (request, reply) => {
      const provider = request.body?.provider;
      if (!provider)
        return reply.code(400).send({ error: "provider required" });
      try {
        return startAuthLoginJob(provider, deps);
      } catch (error) {
        return reply.code(400).send({ error: errorMessage(error) });
      }
    },
  );
  app.get<{ Params: { id: string } }>(
    "/api/auth/login-jobs/:id",
    async (request, reply) => {
      const job = authLoginJobs.get(request.params.id);
      if (!job) return reply.code(404).send({ error: "login job not found" });
      return authJobStatus(job);
    },
  );
  app.post<{ Params: { id: string }; Body: { value?: string } }>(
    "/api/auth/login-jobs/:id/input",
    async (request, reply) => {
      const job = authLoginJobs.get(request.params.id);
      if (!job) return reply.code(404).send({ error: "login job not found" });
      const resolveInput = job.resolveInput;
      if (!resolveInput)
        return reply
          .code(409)
          .send({ error: "login is not waiting for input" });
      job.resolveInput = undefined;
      job.rejectInput = undefined;
      job.status = "running";
      job.step = { type: "progress", message: "Continuing login…" };
      resolveInput(request.body?.value ?? "");
      return authJobStatus(job);
    },
  );
  app.delete<{ Params: { id: string } }>(
    "/api/auth/login-jobs/:id",
    async (request) => {
      const job = authLoginJobs.get(request.params.id);
      job?.abort.abort();
      job?.rejectInput?.(new Error("Login cancelled"));
      authLoginJobs.delete(request.params.id);
      return { success: true };
    },
  );
}

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

type AuthLoginJob = {
  id: string;
  provider: string;
  providerName: string;
  status: "running" | "waiting" | "done" | "error";
  step?: AuthJobStep;
  messages: string[];
  error?: string;
  authInfo?: { url: string; instructions?: string };
  abort: AbortController;
  resolveInput?: (value: string) => void;
  rejectInput?: (error: Error) => void;
};

const authLoginJobs = new Map<string, AuthLoginJob>();
const OAUTH_PROVIDERS_WITH_API_KEYS = new Set(["anthropic"]);

function canUseApiKey(provider: string, oauthProviderIds: Set<string>) {
  return (
    !oauthProviderIds.has(provider) ||
    OAUTH_PROVIDERS_WITH_API_KEYS.has(provider)
  );
}

function providerAuthTypes(supportsOAuth: boolean, supportsApiKey: boolean) {
  return [
    ...(supportsOAuth ? ["oauth"] : []),
    ...(supportsApiKey ? ["api_key"] : []),
  ];
}

function authJobStatus(job: AuthLoginJob) {
  return {
    id: job.id,
    provider: job.provider,
    providerName: job.providerName,
    status: job.status,
    step: job.step,
    messages: job.messages,
    error: job.error,
  };
}

function setAuthJobStep(
  job: AuthLoginJob,
  status: AuthLoginJob["status"],
  step: AuthJobStep,
) {
  job.status = status;
  job.step = step;
  if (step.type === "progress") job.messages.push(step.message);
}

function waitForAuthInput(job: AuthLoginJob, step: AuthJobStep) {
  setAuthJobStep(job, "waiting", step);
  return new Promise<string>((resolve, reject) => {
    if (job.abort.signal.aborted) {
      reject(new Error("Login cancelled"));
      return;
    }
    const cleanup = () => {
      job.abort.signal.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(new Error("Login cancelled"));
    };
    job.resolveInput = (value) => {
      cleanup();
      resolve(value);
    };
    job.rejectInput = (error) => {
      cleanup();
      reject(error);
    };
    job.abort.signal.addEventListener("abort", onAbort, { once: true });
  });
}

function startAuthLoginJob(provider: string, deps: Deps) {
  const auth = AuthStorage.create();
  const providerInfo = auth
    .getOAuthProviders()
    .find((item) => item.id === provider);
  if (!providerInfo) throw new Error(`No subscription login for ${provider}`);

  const job: AuthLoginJob = {
    id: randomUUID(),
    provider,
    providerName: providerInfo.name,
    status: "running",
    messages: [],
    abort: new AbortController(),
  };
  authLoginJobs.set(job.id, job);
  setTimeout(() => authLoginJobs.delete(job.id), 30 * 60_000).unref?.();

  void auth
    .login(provider, {
      onAuth: (info: { url: string; instructions?: string }) => {
        job.authInfo = info;
        setAuthJobStep(job, "running", { type: "auth_url", ...info });
      },
      onDeviceCode: (info: any) =>
        setAuthJobStep(job, "running", { type: "device_code", ...info }),
      onPrompt: (prompt: any) =>
        waitForAuthInput(job, {
          type: "prompt",
          message: prompt.message,
          placeholder: prompt.placeholder,
          allowEmpty: prompt.allowEmpty,
        }),
      onProgress: (message: string) =>
        setAuthJobStep(job, "running", { type: "progress", message }),
      onManualCodeInput: () =>
        waitForAuthInput(job, {
          type: "manual_code",
          message:
            "Complete login in your browser, or paste the authorization code / redirect URL here:",
          placeholder: job.authInfo?.url,
          url: job.authInfo?.url,
          instructions: job.authInfo?.instructions,
        }),
      onSelect: (prompt: any) =>
        waitForAuthInput(job, {
          type: "select",
          message: prompt.message,
          options: prompt.options ?? [],
        }),
      signal: job.abort.signal,
    } as any)
    .then(() => {
      refreshLiveAuth(deps);
      job.resolveInput = undefined;
      job.rejectInput = undefined;
      setAuthJobStep(job, "done", {
        type: "done",
        message: `Logged in to ${providerInfo.name}`,
      });
    })
    .catch((error) => {
      job.resolveInput = undefined;
      job.rejectInput = undefined;
      job.error = errorMessage(error);
      setAuthJobStep(job, "error", { type: "error", message: job.error });
    });

  return authJobStatus(job);
}

function refreshLiveAuth(deps: Deps) {
  for (const session of deps.liveSessions.values()) {
    try {
      session.inner.modelRegistry.authStorage.reload();
      session.inner.modelRegistry.refresh();
      session.broadcast({ type: "status", status: session.status() });
    } catch {
      // Best effort; stale sessions will refresh on next process start.
    }
  }
}

async function providerResponse(includeAll: boolean) {
  const auth = AuthStorage.create();
  const registry = ModelRegistry.create(auth);
  const models = includeAll ? registry.getAll() : registry.getAvailable();
  const oauthProviders = auth.getOAuthProviders();
  const oauthProviderIds = new Set(
    oauthProviders.map((provider) => provider.id),
  );
  const providers = new Map<string, any>();
  for (const model of models) {
    const supportsOAuth = oauthProviderIds.has(model.provider);
    const supportsApiKey = canUseApiKey(model.provider, oauthProviderIds);
    const current = providers.get(model.provider) ?? {
      id: model.provider,
      name: registry.getProviderDisplayName(model.provider),
      auth: registry.getProviderAuthStatus(model.provider),
      authTypes: providerAuthTypes(supportsOAuth, supportsApiKey),
      supportsOAuth,
      supportsApiKey,
      models: [],
    };
    current.models.push({
      id: model.id,
      name: model.name,
      contextWindow: model.contextWindow,
      reasoning: (model as any).reasoning,
    });
    providers.set(model.provider, current);
  }
  for (const oauth of oauthProviders) {
    const current = providers.get(oauth.id);
    if (current) {
      current.supportsOAuth = true;
      current.authTypes = providerAuthTypes(
        true,
        Boolean(current.supportsApiKey),
      );
      continue;
    }
    providers.set(oauth.id, {
      id: oauth.id,
      name: oauth.name ?? oauth.id,
      auth: auth.getAuthStatus(oauth.id),
      authTypes: providerAuthTypes(true, false),
      supportsOAuth: true,
      supportsApiKey: false,
      models: [],
    });
  }
  return { providers: [...providers.values()] };
}

function registerSkillRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { cwd?: string } }>(
    "/api/skills",
    async (request, reply) => {
      if (!request.query.cwd)
        return reply.code(400).send({ error: "cwd required" });
      const loader = new DefaultResourceLoader({
        cwd: resolve(request.query.cwd),
        agentDir: getAgentDir(),
      } as any);
      await loader.reload();
      return loader.getSkills();
    },
  );
  app.patch<{ Body: { filePath?: string; disableModelInvocation?: boolean } }>(
    "/api/skills",
    async (request, reply) => {
      const filePath = request.body?.filePath;
      if (!filePath)
        return reply.code(400).send({ error: "filePath required" });
      if (!existsSync(filePath))
        return reply.code(404).send({ error: "file not found" });
      const content = await readFile(filePath, "utf8");
      const key = "disable-model-invocation";
      const { frontmatter } =
        parseFrontmatter<Record<string, unknown>>(content);
      const hasKey = Boolean(frontmatter[key]);
      let updated = content;
      if (request.body?.disableModelInvocation && !hasKey)
        updated = content.replace(/^---\r?\n/, `---\n${key}: true\n`);
      if (request.body?.disableModelInvocation && updated === content)
        updated = `---\n${key}: true\n---\n${content}`;
      if (!request.body?.disableModelInvocation && hasKey)
        updated = content.replace(new RegExp(`^${key}\\s*:.*\\r?\\n`, "m"), "");
      await writeFile(filePath, updated);
      return { success: true };
    },
  );
}

function registerPackageRoutes(app: FastifyInstance, deps: Deps) {
  app.get<{ Querystring: { cwd?: string } }>("/api/plugins", async (request) =>
    readPiPackages(resolve(request.query.cwd || deps.defaultCwd)),
  );
  app.get("/api/pi-packages", async () => readPiPackages(deps.defaultCwd));
}

async function readPiPackages(cwd: string) {
  const settingsManager = SettingsManager.create(cwd, getAgentDir());
  const manager = new DefaultPackageManager({
    cwd,
    agentDir: getAgentDir(),
    settingsManager,
  });
  const packages = manager.listConfiguredPackages().map((pkg: any) => ({
    source: pkg.source,
    scope: pkg.scope === "project" ? "project" : "global",
    filtered: Boolean(pkg.filtered),
    disabled: false,
    installedPath: pkg.installedPath,
    counts: { extensions: 0, skills: 0, prompts: 0, themes: 0 },
    resources: [],
    status: pkg.installedPath ? "installed" : "missing",
  }));
  return {
    packages,
    totals: { extensions: 0, skills: 0, prompts: 0, themes: 0 },
    diagnostics: [],
  };
}

function registerMachineRoutes(app: FastifyInstance) {
  app.get("/api/machines", async () => ({
    machines: [{ id: "local", name: "Local", kind: "local", url: "local" }],
  }));
}
