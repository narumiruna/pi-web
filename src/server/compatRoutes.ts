// biome-ignore-all lint: compatibility routes intentionally accept third-party wire shapes.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, statSync, watch } from "node:fs";
import {
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  extname,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import {
  AuthStorage,
  buildSessionContext,
  DefaultPackageManager,
  DefaultResourceLoader,
  getAgentDir,
  ModelRegistry,
  parseFrontmatter,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { FastifyInstance, FastifyReply } from "fastify";
import { resolveInside } from "./pathSafety.js";
import { TerminalManager } from "./terminalManager.js";

type Json = Record<string, unknown>;
type Deps = {
  defaultCwd: string;
  listSessions: () => Promise<any[]>;
  resolveSessionPath: (id: string) => Promise<string | undefined>;
  getLiveSession: (id: string) => Promise<any>;
  startSession: (
    cwd: string,
    sessionFile?: string,
    toolNames?: string[],
  ) => Promise<any>;
  liveSessions: Map<string, any>;
};

type StoredProject = {
  id: string;
  name: string;
  path: string;
  createdAt: string;
};
type StoredMachine = {
  id: string;
  name: string;
  url: string;
  token?: string;
  kind: "remote";
};

const terminalManager = new TerminalManager();
const loginCallbacks = new Map<
  string,
  { resolve: (value: string) => void; reject: (error: Error) => void }
>();
const archiveDirName = ".pi-web-archived-sessions";

export function registerCompatRoutes(app: FastifyInstance, deps: Deps) {
  addBinaryParsers(app);
  registerUtilityRoutes(app, deps);
  registerAuthRoutes(app);
  registerModelConfigRoutes(app);
  registerSkillRoutes(app);
  registerPluginRoutes(app, deps);
  registerSessionCompatRoutes(app, deps);
  registerAgentCompatRoutes(app, deps);
  registerFileCompatRoutes(app, deps);
  registerProjectRoutes(app, deps);
  registerMachineRoutes(app);
  registerTerminalRoutes(app);
  registerPiPackageRoutes(app, deps);
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
  app.get("/api/machines/local/config", async () => readJson(configPath(), {}));
  app.put<{ Body: { config?: unknown } }>(
    "/api/machines/local/config",
    async (request) => {
      await writeJson(configPath(), request.body?.config ?? {});
      return { saved: true, config: request.body?.config ?? {} };
    },
  );
}

function registerAuthRoutes(app: FastifyInstance) {
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
    return { success: true };
  });
  app.delete<{ Params: { provider: string } }>(
    "/api/auth/api-key/:provider",
    async (request) => {
      AuthStorage.create().remove(request.params.provider);
      return { success: true };
    },
  );
  app.post<{
    Params: { provider: string };
    Body: { token?: string; code?: string };
  }>("/api/auth/login/:provider", async (request, reply) => {
    const token = request.body?.token;
    const code = request.body?.code;
    const callback = token ? loginCallbacks.get(token) : undefined;
    if (!token || !code || !callback)
      return reply.code(400).send({ error: "token/code mismatch" });
    callback.resolve(code);
    loginCallbacks.delete(token);
    return { ok: true };
  });
  app.get<{ Params: { provider: string } }>(
    "/api/auth/login/:provider",
    async (request, reply) => oauthLoginStream(reply, request.params.provider),
  );
  app.post<{ Params: { provider: string } }>(
    "/api/auth/logout/:provider",
    async (request) => {
      AuthStorage.create().logout(request.params.provider);
      return { success: true };
    },
  );
}

async function providerResponse(includeAll: boolean) {
  const auth = AuthStorage.create();
  const registry = ModelRegistry.create(auth);
  const models = includeAll ? registry.getAll() : registry.getAvailable();
  const providers = new Map<string, any>();
  for (const model of models) {
    const current = providers.get(model.provider) ?? {
      id: model.provider,
      name: registry.getProviderDisplayName(model.provider),
      auth: registry.getProviderAuthStatus(model.provider),
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
  for (const oauth of auth.getOAuthProviders()) {
    if (!providers.has(oauth.id))
      providers.set(oauth.id, {
        id: oauth.id,
        name: oauth.name ?? oauth.id,
        auth: auth.getAuthStatus(oauth.id),
        models: [],
      });
  }
  return { providers: [...providers.values()] };
}

async function oauthLoginStream(reply: FastifyReply, provider: string) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      try {
        await AuthStorage.create().login(provider as any, {
          onAuth: (info: any) => {
            const token = `${provider}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
            const promise = new Promise<string>((resolve, reject) =>
              loginCallbacks.set(token, { resolve, reject }),
            );
            send({
              type: "auth",
              token,
              url: info.url,
              instructions: info.instructions ?? null,
            });
            return promise;
          },
          onManualCodeInput: () => {
            const token = `${provider}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
            const promise = new Promise<string>((resolve, reject) =>
              loginCallbacks.set(token, { resolve, reject }),
            );
            send({
              type: "prompt_request",
              token,
              message: "Paste the authorization code",
            });
            return promise;
          },
          onDeviceCode: (info: any) => send({ type: "device_code", ...info }),
          onPrompt: async (prompt: any) => {
            const token = `${provider}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
            const promise = new Promise<string>((resolve, reject) =>
              loginCallbacks.set(token, { resolve, reject }),
            );
            send({ type: "prompt_request", token, ...prompt });
            return promise;
          },
          onProgress: (message: string) => send({ type: "progress", message }),
          onSelect: async (prompt: any) => prompt.options?.[0]?.id,
        });
        send({ type: "success" });
      } catch (error) {
        send({ type: "error", message: errorMessage(error) });
      } finally {
        controller.close();
      }
    },
  });
  return reply
    .header("Content-Type", "text/event-stream")
    .header("Cache-Control", "no-cache")
    .send(stream);
}

function registerModelConfigRoutes(app: FastifyInstance) {
  app.get("/api/models-config", async () =>
    readJson(modelsConfigPath(), { models: [] }),
  );
  app.put<{ Body: unknown }>("/api/models-config", async (request) => {
    await writeJson(modelsConfigPath(), request.body ?? {});
    return { success: true };
  });
  app.post<{ Body: { provider?: string; modelId?: string } }>(
    "/api/models-config/test",
    async (request) => {
      const provider = request.body?.provider;
      const modelId = request.body?.modelId;
      if (!provider || !modelId)
        return { ok: false, error: "provider and modelId required" };
      const registry = ModelRegistry.create(AuthStorage.create());
      const model = registry.find(provider, modelId);
      if (!model) return { ok: false, error: "model not found" };
      const auth = await registry.getApiKeyAndHeaders(model);
      if (auth.ok) return { ok: true, model: { provider, id: modelId } };
      return { ok: false, error: (auth as { error: string }).error };
    },
  );
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
  app.post<{ Body: { query?: string; limit?: number } }>(
    "/api/skills/search",
    async (request, reply) => {
      const query = request.body?.query?.trim();
      if (!query) return reply.code(400).send({ error: "query required" });
      try {
        const res = await fetch(
          `https://skills.sh/api/search?q=${encodeURIComponent(query)}&limit=${request.body?.limit ?? 20}`,
        );
        if (res.ok) {
          const data: any = await res.json();
          return {
            results: (data.skills ?? []).map((skill: any) => ({
              package: `${skill.source ?? skill.id}@${skill.name}`,
              installs: skill.installs ? `${skill.installs} installs` : "",
              url: skill.id ? `https://skills.sh/${skill.id}` : "",
            })),
          };
        }
      } catch {
        // offline search falls through to empty result
      }
      return { results: [] };
    },
  );
  app.post<{ Body: { package?: string } }>(
    "/api/skills/install",
    async (request, reply) => {
      if (!request.body?.package)
        return reply.code(400).send({ error: "package required" });
      const result = await runCommand(
        "npx",
        ["skills", "install", request.body.package],
        process.cwd(),
        120_000,
      );
      return result.code === 0
        ? { success: true, output: result.output }
        : reply.code(500).send({ error: result.output });
    },
  );
}

function registerPluginRoutes(app: FastifyInstance, deps: Deps) {
  app.get<{ Querystring: { cwd?: string } }>("/api/plugins", async (request) =>
    request.query.cwd
      ? readPiPackages(resolve(request.query.cwd))
      : { plugins: await discoverPiWebPlugins() },
  );
  app.post<{
    Body: {
      action?: string;
      source?: string;
      scope?: "global" | "project";
      cwd?: string;
    };
  }>("/api/plugins", async (request, reply) => {
    if (!request.body?.cwd)
      return reply.code(400).send({ error: "cwd required" });
    if (!request.body?.action)
      return reply.code(400).send({ error: "action required" });
    const cwd = resolve(request.body.cwd);
    const settingsManager = SettingsManager.create(cwd, getAgentDir());
    const manager = new DefaultPackageManager({
      cwd,
      agentDir: getAgentDir(),
      settingsManager,
    });
    const source = request.body.source?.trim();
    if (
      ["install", "remove", "disable", "enable"].includes(
        request.body.action,
      ) &&
      !source
    )
      return reply.code(400).send({ error: "source required" });
    if (request.body.action === "install")
      await manager.installAndPersist(source!, {
        local: request.body.scope === "project",
      });
    else if (request.body.action === "remove")
      await manager.removeAndPersist(source!, {
        local: request.body.scope === "project",
      });
    else if (request.body.action === "update") await manager.update(source);
    else if (
      request.body.action === "disable" ||
      request.body.action === "enable"
    )
      await setPackageEnabled(
        settingsManager,
        source!,
        request.body.scope === "project",
        request.body.action === "enable",
      );
    else
      return reply
        .code(400)
        .send({ error: `Unsupported action: ${request.body.action}` });
    await settingsManager.flush();
    return readPiPackages(cwd);
  });
  app.get("/pi-web-plugins/manifest.json", async () => ({
    plugins: await discoverPiWebPlugins(),
  }));
  app.get<{ Params: { pluginId: string; "*": string } }>(
    "/pi-web-plugins/:pluginId/*",
    async (request, reply) => {
      const plugin = (await discoverPiWebPlugins()).find(
        (item: any) => item.id === request.params.pluginId,
      );
      if (!plugin?.root)
        return reply.code(404).send({ error: "Plugin not found" });
      const file = resolveInside(plugin.root, request.params["*"] || ".");
      return reply.type(mimeFromPath(file)).send(await readFile(file));
    },
  );
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

async function setPackageEnabled(
  settings: any,
  source: string,
  project: boolean,
  enabled: boolean,
) {
  const current = project
    ? (settings.getProjectSettings().packages ?? [])
    : (settings.getGlobalSettings().packages ?? []);
  const next = current.map((entry: any) =>
    getPackageSource(entry) === source
      ? enabled
        ? source
        : {
            ...(typeof entry === "string" ? { source: entry } : entry),
            extensions: [],
            skills: [],
            prompts: [],
            themes: [],
          }
      : entry,
  );
  if (project) settings.setProjectPackages(next);
  else settings.setPackages(next);
}

function getPackageSource(entry: any) {
  return typeof entry === "string" ? entry : entry.source;
}

async function discoverPiWebPlugins() {
  const roots = [join(piWebDir(), "plugins")];
  const plugins: any[] = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const packageRoot = join(root, entry.name);
      const pkg = await readJson(join(packageRoot, "package.json"), undefined);
      for (const plugin of pkg?.piWeb?.plugins ?? []) {
        if (
          typeof plugin.id === "string" &&
          typeof plugin.module === "string"
        ) {
          plugins.push({
            id: plugin.id,
            module: `/pi-web-plugins/${plugin.id}/${plugin.module}`,
            source: "local",
            scope: "local",
            machineSpecific: Boolean(plugin.machineSpecific),
            root: packageRoot,
          });
        }
      }
    }
  }
  return plugins;
}

function registerSessionCompatRoutes(app: FastifyInstance, deps: Deps) {
  app.get<{ Params: { id: string }; Querystring: { includeState?: string } }>(
    "/api/sessions/:id",
    async (request, reply) => {
      const current = await sessionManagerFor(deps, request.params.id);
      if (!current) return reply.code(404).send({ error: "Session not found" });
      const context = contextWithEntryIds(current.manager);
      return {
        session: sessionSummary(current.manager, current.file),
        messages: context.messages,
        entryIds: context.entryIds,
        tree: current.manager.getTree(),
        state:
          request.query.includeState === undefined
            ? undefined
            : await sessionState(deps, request.params.id),
      };
    },
  );
  app.patch<{ Params: { id: string }; Body: { name?: string } }>(
    "/api/sessions/:id",
    async (request, reply) => {
      if (!request.body?.name?.trim())
        return reply.code(400).send({ error: "name is required" });
      const session = await deps.getLiveSession(request.params.id);
      session.inner.setSessionName(request.body.name.trim());
      return { ok: true };
    },
  );
  app.delete<{ Params: { id: string } }>(
    "/api/sessions/:id",
    async (request, reply) => {
      const file = await deps.resolveSessionPath(request.params.id);
      if (!file) return reply.code(404).send({ error: "Session not found" });
      deps.liveSessions.get(request.params.id)?.dispose?.();
      await unlink(file);
      return { ok: true, deleted: true };
    },
  );
  app.get<{ Params: { id: string }; Querystring: { leafId?: string } }>(
    "/api/sessions/:id/context",
    async (request, reply) => {
      const current = await sessionManagerFor(deps, request.params.id);
      if (!current) return reply.code(404).send({ error: "Session not found" });
      return {
        context: contextWithEntryIds(current.manager, request.query.leafId),
      };
    },
  );
  app.get<{ Params: { id: string } }>(
    "/api/sessions/:id/export",
    async (request, reply) => {
      const current = await sessionManagerFor(deps, request.params.id);
      if (!current) return reply.code(404).send({ error: "Session not found" });
      const html = transcriptHtml(
        contextWithEntryIds(current.manager).messages,
      );
      return reply
        .header("Content-Type", "text/html; charset=utf-8")
        .header(
          "Content-Disposition",
          `attachment; filename="${request.params.id}.html"`,
        )
        .send(html);
    },
  );
  app.post<{ Body: { olderThanDays?: number } }>(
    "/api/sessions/cleanup/preview",
    async () => ({ sessions: [], count: 0, bytes: 0 }),
  );
  app.post("/api/sessions/cleanup", async () => ({ deleted: [], count: 0 }));
  app.post<{ Body: { sessions?: Array<{ id: string }> } }>(
    "/api/sessions/bulk/archive",
    async (request) => ({
      archived: request.body?.sessions?.map((item) => item.id) ?? [],
    }),
  );
  app.post<{ Body: { sessions?: Array<{ id: string }> } }>(
    "/api/sessions/bulk/delete-archived",
    async (request) => ({
      deleted: request.body?.sessions?.map((item) => item.id) ?? [],
    }),
  );
  for (const prefix of ["", "/api/machines/local"])
    registerJmfSessionAliases(app, deps, prefix);
}

function registerJmfSessionAliases(
  app: FastifyInstance,
  deps: Deps,
  prefix: string,
) {
  app.get<{ Querystring: { cwd?: string } }>(
    `${prefix}/sessions`,
    async (request) => {
      const sessions = await deps.listSessions();
      return request.query.cwd
        ? sessions.filter(
            (session) => session.cwd === resolve(request.query.cwd!),
          )
        : sessions;
    },
  );
  app.post<{ Body: { cwd?: string } }>(`${prefix}/sessions`, async (request) =>
    deps
      .startSession(resolve(request.body?.cwd || deps.defaultCwd))
      .then((session) => ({ id: session.id, cwd: session.cwd })),
  );
  app.get<{ Params: { sessionId: string } }>(
    `${prefix}/sessions/:sessionId/models`,
    async () => ({
      models: await ModelRegistry.create(AuthStorage.create()).getAvailable(),
    }),
  );
  app.get<{ Params: { sessionId: string } }>(
    `${prefix}/sessions/:sessionId/thinking-levels`,
    async (request) => ({
      levels: (
        await deps.getLiveSession(request.params.sessionId)
      ).inner.getAvailableThinkingLevels?.() ?? [
        "off",
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
      ],
    }),
  );
  app.post<{ Params: { sessionId: string }; Body: { level?: string } }>(
    `${prefix}/sessions/:sessionId/thinking-level`,
    async (request) =>
      dispatchSessionCommand(deps, request.params.sessionId, {
        type: "set_thinking_level",
        level: request.body?.level,
      }),
  );
  app.post<{ Params: { sessionId: string } }>(
    `${prefix}/sessions/:sessionId/thinking-level/cycle`,
    async (request) => ({
      level: (
        await deps.getLiveSession(request.params.sessionId)
      ).inner.cycleThinkingLevel?.(),
    }),
  );
  app.post<{
    Params: { sessionId: string };
    Body: { direction?: "forward" | "backward" };
  }>(`${prefix}/sessions/:sessionId/model/cycle`, async (request) => ({
    result: await (
      await deps.getLiveSession(request.params.sessionId)
    ).inner.cycleModel(request.body?.direction),
  }));
  app.post<{
    Params: { sessionId: string };
    Body: { text?: string; streamingBehavior?: any; attachments?: any };
  }>(`${prefix}/sessions/:sessionId/prompt`, async (request) =>
    dispatchSessionCommand(deps, request.params.sessionId, {
      type: "prompt",
      message: request.body?.text ?? "",
      streamingBehavior: request.body?.streamingBehavior,
      images: request.body?.attachments,
    }),
  );
  app.post<{ Params: { sessionId: string }; Body: { text?: string } }>(
    `${prefix}/sessions/:sessionId/shell`,
    async (request) => ({
      result: await (
        await deps.getLiveSession(request.params.sessionId)
      ).inner.executeBash(request.body?.text ?? ""),
    }),
  );
  app.post<{ Params: { sessionId: string }; Body: { text?: string } }>(
    `${prefix}/sessions/:sessionId/commands/run`,
    async (request) =>
      dispatchSessionCommand(deps, request.params.sessionId, {
        type: "prompt",
        message: request.body?.text ?? "",
      }),
  );
  app.post<{ Params: { sessionId: string } }>(
    `${prefix}/sessions/:sessionId/stop`,
    async (request) => {
      deps.liveSessions.get(request.params.sessionId)?.dispose?.();
      deps.liveSessions.delete(request.params.sessionId);
      return { stopped: true };
    },
  );
  app.post<{ Params: { sessionId: string } }>(
    `${prefix}/sessions/:sessionId/archive`,
    async (request) => archiveSession(deps, request.params.sessionId),
  );
  app.post<{ Params: { sessionId: string } }>(
    `${prefix}/sessions/:sessionId/archive-tree`,
    async (request) => archiveSession(deps, request.params.sessionId),
  );
  app.post<{ Params: { sessionId: string } }>(
    `${prefix}/sessions/:sessionId/restore`,
    async () => ({ restored: true }),
  );
  app.post<{ Params: { sessionId: string } }>(
    `${prefix}/sessions/:sessionId/reload`,
    async (request) =>
      dispatchSessionCommand(deps, request.params.sessionId, {
        type: "reload",
      }),
  );
  app.post<{ Params: { sessionId: string } }>(
    `${prefix}/sessions/:sessionId/detach-parent`,
    async (request) => detachParent(deps, request.params.sessionId),
  );
}

function registerAgentCompatRoutes(app: FastifyInstance, deps: Deps) {
  app.post<{ Body: any }>("/api/agent/new", async (request) => {
    const body = (request.body ?? {}) as any;
    const session = await deps.startSession(
      resolve(body.cwd || deps.defaultCwd),
      undefined,
      body.toolNames,
    );
    if (body.provider && body.modelId)
      await dispatchSessionCommand(deps, session.id, {
        type: "set_model",
        provider: body.provider,
        modelId: body.modelId,
      });
    if (body.thinkingLevel)
      await dispatchSessionCommand(deps, session.id, {
        type: "set_thinking_level",
        level: body.thinkingLevel,
      });
    return { sessionId: session.id, id: session.id, cwd: session.cwd };
  });
  app.get<{ Params: { id: string } }>("/api/agent/:id", async (request) => ({
    running: deps.liveSessions.has(request.params.id),
    state: await sessionState(deps, request.params.id),
  }));
  app.post<{ Params: { id: string }; Body: any }>(
    "/api/agent/:id",
    async (request) => ({
      success: true,
      data: await dispatchSessionCommand(
        deps,
        request.params.id,
        request.body ?? {},
      ),
    }),
  );
  app.get<{ Params: { id: string } }>(
    "/api/agent/:id/events",
    async (request, reply) =>
      eventStream(reply, await deps.getLiveSession(request.params.id)),
  );
  app.get("/api/agent/running/events", async (_request, reply) => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        const send = () =>
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "running", sessions: [...deps.liveSessions.values()].map((session) => session.status()) })}\n\n`,
            ),
          );
        send();
        const timer = setInterval(send, 1000);
        setTimeout(() => {
          clearInterval(timer);
          controller.close();
        }, 30_000);
      },
    });
    return reply.header("Content-Type", "text/event-stream").send(stream);
  });
}

async function dispatchSessionCommand(
  deps: Deps,
  id: string,
  command: any,
): Promise<any> {
  const session = await deps.getLiveSession(id);
  await session.ready;
  switch (command.type) {
    case "prompt":
      return session.prompt(
        command.message ?? command.text ?? "",
        command.images,
        command.streamingBehavior,
      );
    case "steer":
      return session.inner.steer(command.message ?? "", command.images);
    case "follow_up":
      return session.inner.followUp(command.message ?? "", command.images);
    case "abort":
      return session.inner.abort();
    case "compact":
      return session.inner.compact(command.customInstructions);
    case "abort_compaction":
      return session.inner.abortCompaction();
    case "set_model": {
      const model = session.inner.modelRegistry.find(
        command.provider,
        command.modelId,
      );
      if (!model) throw new Error("Model not found");
      await session.inner.setModel(model);
      return { provider: model.provider, id: model.id };
    }
    case "set_thinking_level":
      session.inner.setThinkingLevel(command.level);
      return null;
    case "get_tools":
      return toolsFor(session);
    case "set_tools":
      session.inner.setActiveToolsByName(command.toolNames ?? []);
      return null;
    case "get_commands":
      return { commands: commandList(session.inner) };
    case "get_state":
      return session.status();
    case "get_session_stats":
      return session.inner.getSessionStats();
    case "get_last_assistant_text":
      return { text: session.inner.getLastAssistantText?.() ?? "" };
    case "set_session_name":
      session.inner.setSessionName(command.name);
      return null;
    case "navigate_tree":
      return session.inner.navigateTree(command.targetId, {});
    case "fork":
      return forkSession(deps, id, command.entryId);
    case "reload":
      await session.inner.reload();
      return { success: true };
    case "set_auto_compaction":
      session.inner.setAutoCompactionEnabled(Boolean(command.enabled));
      return null;
    case "set_auto_retry":
      session.inner.setAutoRetryEnabled(Boolean(command.enabled));
      return null;
    default:
      throw new Error(`Unsupported command: ${command.type}`);
  }
}

function registerFileCompatRoutes(app: FastifyInstance, deps: Deps) {
  app.get<{ Params: { "*": string }; Querystring: { type?: string } }>(
    "/api/files/*",
    async (request, reply) => {
      const file = absoluteFromWildcard(request.params["*"]);
      const type = request.query.type ?? "read";
      if (type === "list")
        return { entries: await fileEntries(file), path: file };
      if (type === "meta") return fileMeta(file);
      if (type === "watch") return fileWatch(reply, file);
      return reply.type(mimeFromPath(file)).send(await readFile(file));
    },
  );
  for (const prefix of ["/api", "/api/machines/local"])
    registerWorkspaceRoutes(app, deps, prefix);
}

function registerWorkspaceRoutes(
  app: FastifyInstance,
  deps: Deps,
  prefix: string,
) {
  app.get<{
    Params: { projectId: string; workspaceId: string };
    Querystring: { path?: string };
  }>(
    `${prefix}/projects/:projectId/workspaces/:workspaceId/tree`,
    async (request) => ({
      entries: await workspaceEntries(
        deps,
        request.params.projectId,
        request.params.workspaceId,
        request.query.path,
      ),
      path: request.query.path ?? "",
    }),
  );
  app.get<{
    Params: { projectId: string; workspaceId: string };
    Querystring: { path?: string };
  }>(
    `${prefix}/projects/:projectId/workspaces/:workspaceId/file`,
    async (request) =>
      readWorkspaceFile(
        await workspaceRoot(
          deps,
          request.params.projectId,
          request.params.workspaceId,
        ),
        request.query.path,
      ),
  );
  app.put<{
    Params: { projectId: string; workspaceId: string };
    Querystring: { path?: string; createDirs?: string; overwrite?: string };
    Body: Buffer;
  }>(
    `${prefix}/projects/:projectId/workspaces/:workspaceId/file`,
    async (request, reply) =>
      writeWorkspaceFile(
        reply,
        await workspaceRoot(
          deps,
          request.params.projectId,
          request.params.workspaceId,
        ),
        request.query.path,
        request.body,
        request.query,
      ),
  );
  app.delete<{
    Params: { projectId: string; workspaceId: string };
    Querystring: { path?: string };
  }>(
    `${prefix}/projects/:projectId/workspaces/:workspaceId/file`,
    async (request) =>
      deleteWorkspaceFile(
        await workspaceRoot(
          deps,
          request.params.projectId,
          request.params.workspaceId,
        ),
        request.query.path,
      ),
  );
  app.post<{
    Params: { projectId: string; workspaceId: string };
    Querystring: { fromPath?: string; toPath?: string; overwrite?: string };
  }>(
    `${prefix}/projects/:projectId/workspaces/:workspaceId/file/move`,
    async (request) =>
      moveWorkspaceFile(
        await workspaceRoot(
          deps,
          request.params.projectId,
          request.params.workspaceId,
        ),
        request.query.fromPath,
        request.query.toPath,
        request.query.overwrite === "true",
      ),
  );
  app.get<{
    Params: { projectId: string; workspaceId: string };
    Querystring: { path?: string };
  }>(
    `${prefix}/projects/:projectId/workspaces/:workspaceId/file/preview`,
    async (request, reply) => {
      const file = resolveInside(
        await workspaceRoot(
          deps,
          request.params.projectId,
          request.params.workspaceId,
        ),
        request.query.path ?? ".",
      );
      return reply.type(mimeFromPath(file)).send(await readFile(file));
    },
  );
  app.get<{
    Params: { projectId: string; workspaceId: string };
    Querystring: { q?: string; mode?: string };
  }>(
    `${prefix}/projects/:projectId/workspaces/:workspaceId/files`,
    async (request) =>
      listSuggestions(
        await workspaceRoot(
          deps,
          request.params.projectId,
          request.params.workspaceId,
        ),
        request.query.q ?? "",
        request.query.mode === "path",
      ),
  );
  app.get<{ Params: { projectId: string; workspaceId: string } }>(
    `${prefix}/projects/:projectId/workspaces/:workspaceId/git/status`,
    async (request) =>
      gitStatus(
        await workspaceRoot(
          deps,
          request.params.projectId,
          request.params.workspaceId,
        ),
      ),
  );
  app.get<{
    Params: { projectId: string; workspaceId: string };
    Querystring: { path?: string; staged?: string };
  }>(
    `${prefix}/projects/:projectId/workspaces/:workspaceId/git/diff`,
    async (request) =>
      gitDiff(
        await workspaceRoot(
          deps,
          request.params.projectId,
          request.params.workspaceId,
        ),
        request.query.path,
        request.query.staged === "true",
      ),
  );
}

function registerProjectRoutes(app: FastifyInstance, deps: Deps) {
  for (const prefix of ["/api", "/api/machines/local"]) {
    app.get(`${prefix}/projects`, async () => ({
      projects: await listProjects(deps.defaultCwd),
    }));
    app.post<{ Body: { name?: string; path: string; create?: boolean } }>(
      `${prefix}/projects`,
      async (request, reply) => {
        try {
          return await addProject(request.body, deps.defaultCwd);
        } catch (error) {
          return reply.code(400).send({ error: errorMessage(error) });
        }
      },
    );
    app.delete<{ Params: { projectId: string } }>(
      `${prefix}/projects/:projectId`,
      async (request) => ({
        closed: await removeProject(request.params.projectId),
      }),
    );
    app.get<{ Querystring: { q?: string } }>(
      `${prefix}/project-directories`,
      async (request) => directorySuggestions(request.query.q ?? ""),
    );
    app.get<{ Params: { projectId: string } }>(
      `${prefix}/projects/:projectId/workspaces`,
      async (request) =>
        workspacesFor(
          await requireProject(request.params.projectId, deps.defaultCwd),
        ),
    );
    app.get(`${prefix}/activity`, async () => ({
      sessions: [],
      terminals: terminalManager.list(deps.defaultCwd),
      updatedAt: new Date().toISOString(),
    }));
  }
}

function registerMachineRoutes(app: FastifyInstance) {
  app.get("/api/machines", async () => ({ machines: await listMachines() }));
  app.post<{ Body: { name?: string; url?: string; token?: string } }>(
    "/api/machines",
    async (request, reply) => {
      if (!request.body?.url)
        return reply.code(400).send({ error: "url required" });
      const machine: StoredMachine = {
        id: randomUUID(),
        name: request.body.name || request.body.url,
        url: request.body.url,
        token: request.body.token,
        kind: "remote",
      };
      const machines = (await readJson(machinesPath(), [])) as StoredMachine[];
      machines.push(machine);
      await writeJson(machinesPath(), machines);
      return machine;
    },
  );
  app.get<{ Params: { machineId: string } }>(
    "/api/machines/:machineId",
    async (request, reply) =>
      (await getMachine(request.params.machineId)) ??
      reply.code(404).send({ error: "Machine not found" }),
  );
  app.patch<{ Params: { machineId: string }; Body: Partial<StoredMachine> }>(
    "/api/machines/:machineId",
    async (request, reply) =>
      updateMachine(request.params.machineId, request.body) ??
      reply.code(404).send({ error: "Machine not found" }),
  );
  app.delete<{ Params: { machineId: string } }>(
    "/api/machines/:machineId",
    async (request) => ({
      deleted: await deleteMachine(request.params.machineId),
    }),
  );
  app.get<{ Params: { machineId: string } }>(
    "/api/machines/:machineId/health",
    async (request) => ({
      ok: Boolean(await getMachine(request.params.machineId)),
      checkedAt: new Date().toISOString(),
    }),
  );
  app.get<{ Params: { machineId: string } }>(
    "/api/machines/:machineId/runtime",
    async (request) => ({
      machineId: request.params.machineId,
      runtime: request.params.machineId === "local" ? "local" : "remote",
    }),
  );
}

function registerTerminalRoutes(app: FastifyInstance) {
  for (const prefix of ["/api", "/api/machines/local"]) {
    app.get<{ Querystring: { cwd?: string } }>(
      `${prefix}/terminals`,
      async (request, reply) =>
        request.query.cwd
          ? terminalManager.list(resolve(request.query.cwd))
          : reply.code(400).send({ error: "cwd query parameter is required" }),
    );
    app.post<{ Body: { cwd: string; name?: string } }>(
      `${prefix}/terminals`,
      async (request) =>
        terminalManager.create({
          cwd: resolve(request.body.cwd),
          name: request.body.name,
        }),
    );
    app.delete<{ Querystring: { cwd?: string } }>(
      `${prefix}/terminals`,
      async (request) => {
        terminalManager.closeForCwd(
          resolve(request.query.cwd || process.cwd()),
        );
        return { closed: true };
      },
    );
    app.post<{ Params: { terminalId: string } }>(
      `${prefix}/terminals/:terminalId/continue`,
      async (request) => terminalManager.continue(request.params.terminalId),
    );
    app.delete<{ Params: { terminalId: string } }>(
      `${prefix}/terminals/:terminalId`,
      async (request) => {
        terminalManager.close(request.params.terminalId);
        return { closed: true };
      },
    );
    app.get<{ Params: { terminalId: string } }>(
      `${prefix}/terminals/:terminalId/socket`,
      { websocket: true },
      (socket: any, request) =>
        attachTerminalSocket(socket, request.params.terminalId),
    );
    app.post<{
      Body: {
        cwd: string;
        title?: string;
        command: string;
        metadata?: Record<string, string>;
      };
    }>(`${prefix}/terminal-command-runs`, async (request) =>
      terminalManager.runCommand({
        ...request.body,
        cwd: resolve(request.body.cwd),
      }),
    );
    app.get(`${prefix}/terminal-command-runs`, async () =>
      terminalManager.listCommandRuns(),
    );
    app.get<{ Params: { runId: string } }>(
      `${prefix}/terminal-command-runs/:runId`,
      async (request, reply) =>
        terminalManager.getCommandRun(request.params.runId) ??
        reply.code(404).send({ error: "Terminal command run not found" }),
    );
    app.post<{ Params: { runId: string } }>(
      `${prefix}/terminal-command-runs/:runId/cancel`,
      async (request) => terminalManager.cancelCommandRun(request.params.runId),
    );
  }
}

function registerPiPackageRoutes(app: FastifyInstance, deps: Deps) {
  for (const prefix of ["/api", "/api/machines/local"]) {
    app.get(`${prefix}/pi-packages`, async () =>
      readPiPackages(deps.defaultCwd),
    );
    app.post<{ Body: { source?: string } }>(
      `${prefix}/pi-packages/install`,
      async (request, reply) =>
        mutatePackage(reply, deps.defaultCwd, "install", request.body?.source),
    );
    app.post<{ Body: { source?: string; scope?: string } }>(
      `${prefix}/pi-packages/remove`,
      async (request, reply) =>
        mutatePackage(
          reply,
          deps.defaultCwd,
          "remove",
          request.body?.source,
          request.body?.scope === "project",
        ),
    );
    app.post<{ Body: { source?: string } }>(
      `${prefix}/pi-packages/update`,
      async (request, reply) =>
        mutatePackage(reply, deps.defaultCwd, "update", request.body?.source),
    );
  }
}

async function mutatePackage(
  reply: FastifyReply,
  cwd: string,
  action: string,
  source?: string,
  local?: boolean,
) {
  const settingsManager = SettingsManager.create(cwd, getAgentDir());
  const manager = new DefaultPackageManager({
    cwd,
    agentDir: getAgentDir(),
    settingsManager,
  });
  if ((action === "install" || action === "remove") && !source)
    return reply.code(400).send({ error: "source required" });
  if (action === "install") await manager.installAndPersist(source!, { local });
  if (action === "remove") await manager.removeAndPersist(source!, { local });
  if (action === "update") await manager.update(source);
  await settingsManager.flush();
  return { action, source, packages: (await readPiPackages(cwd)).packages };
}

async function sessionManagerFor(deps: Deps, id: string) {
  const live = deps.liveSessions.get(id);
  const file = live?.inner.sessionFile ?? (await deps.resolveSessionPath(id));
  if (file && existsSync(file))
    return { manager: SessionManager.open(file), file };
  if (live) return { manager: live.inner.sessionManager, file: file ?? "" };
  return undefined;
}

function contextWithEntryIds(manager: any, leafId?: string) {
  const entries = manager.getEntries();
  const context = buildSessionContext(entries, leafId);
  const branch = leafId ? manager.getBranch(leafId) : manager.getBranch();
  const entryIds = branch
    .filter(
      (entry: any) =>
        entry.type === "message" || entry.type === "custom_message",
    )
    .map((entry: any) => entry.id);
  return { ...context, entryIds };
}

function sessionSummary(manager: any, file: string) {
  const header = manager.getHeader?.();
  const modified = existsSync(file)
    ? statSync(file).mtime.toISOString()
    : new Date().toISOString();
  return {
    id: manager.getSessionId(),
    path: file,
    cwd: manager.getCwd(),
    name: manager.getSessionName?.(),
    created: header?.timestamp ?? new Date().toISOString(),
    modified,
    messageCount: manager
      .getEntries()
      .filter((entry: any) => entry.type === "message").length,
    firstMessage: firstMessage(manager),
    parentSessionPath: header?.parentSession,
  };
}

function firstMessage(manager: any) {
  const first = manager
    .getEntries()
    .find(
      (entry: any) =>
        entry.type === "message" && entry.message?.role === "user",
    );
  const content = first?.message?.content;
  return typeof content === "string" ? content : "";
}

function commandList(session: any) {
  const extensionCommands = (
    session.extensionRunner?.getRegisteredCommands?.() ?? []
  ).map((cmd: any) => ({
    name: cmd.invocationName ?? cmd.name,
    description: cmd.description,
    source: "extension",
  }));
  const prompts = (session.promptTemplates ?? []).map((template: any) => ({
    name: template.name,
    description: template.description,
    source: "prompt",
  }));
  const skills = (session.resourceLoader?.getSkills?.().skills ?? []).map(
    (skill: any) => ({
      name: `skill:${skill.name}`,
      description: skill.description,
      source: "skill",
    }),
  );
  return [...extensionCommands, ...prompts, ...skills].filter(
    (cmd) => cmd.name,
  );
}

function toolsFor(session: any) {
  const active = new Set(session.inner.getActiveToolNames());
  return session.inner.getAllTools().map((tool: any) => ({
    name: tool.name,
    description: tool.description,
    active: active.has(tool.name),
  }));
}

async function sessionState(deps: Deps, id: string) {
  try {
    return (await deps.getLiveSession(id)).status();
  } catch {
    return { isStreaming: false };
  }
}

async function forkSession(deps: Deps, id: string, entryId: string) {
  const file = await deps.resolveSessionPath(id);
  if (!file) throw new Error("Session not found");
  const manager = SessionManager.open(file);
  const entry = manager.getEntry(entryId);
  if (!entry) throw new Error("Invalid entry ID for forking");
  const newFile = entry.parentId
    ? manager.createBranchedSession(entry.parentId)
    : SessionManager.create(manager.getCwd(), manager.getSessionDir(), {
        parentSession: file,
      }).getSessionFile();
  if (!newFile) throw new Error("Failed to fork session");
  return {
    cancelled: false,
    newSessionId: SessionManager.open(newFile).getSessionId(),
  };
}

async function archiveSession(deps: Deps, id: string) {
  const file = await deps.resolveSessionPath(id);
  if (!file) throw new Error("Session not found");
  const targetDir = join(dirname(file), archiveDirName);
  await mkdir(targetDir, { recursive: true });
  const target = join(targetDir, basename(file));
  await rename(file, target);
  return { archived: true, path: target };
}

async function detachParent(deps: Deps, id: string) {
  const file = await deps.resolveSessionPath(id);
  if (!file) throw new Error("Session not found");
  const lines = (await readFile(file, "utf8")).split(/\r?\n/);
  const header = JSON.parse(lines[0]);
  delete header.parentSession;
  lines[0] = JSON.stringify(header);
  await writeFile(file, lines.join("\n"));
  return { detached: true };
}

function transcriptHtml(messages: any[]) {
  const body = messages
    .map(
      (message) =>
        `<article><h2>${escapeHtml(message.role ?? "event")}</h2><pre>${escapeHtml(textFromContent(message.content))}</pre></article>`,
    )
    .join("\n");
  return `<!doctype html><meta charset="utf-8"><title>pi-web session</title><style>body{font-family:system-ui;margin:2rem;background:#0d1117;color:#e5e7eb}article{border:1px solid #263244;border-radius:12px;padding:1rem;margin:1rem 0;background:#111827}pre{white-space:pre-wrap}</style>${body}`;
}

function textFromContent(content: any): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map(
      (part) =>
        part?.text ?? part?.thinking ?? (part?.type ? `[${part.type}]` : ""),
    )
    .join("\n");
}

function eventStream(reply: FastifyReply, session: any) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (event: Json) =>
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        );
      send({
        type: "connected",
        sessionId: session.id,
        status: session.status(),
      });
      const unsub = session.on(send);
      return () => unsub();
    },
  });
  return reply
    .header("Content-Type", "text/event-stream")
    .header("Cache-Control", "no-cache")
    .send(stream);
}

function absoluteFromWildcard(path: string) {
  return resolve(sep + path.split("/").map(decodeURIComponent).join(sep));
}

async function fileEntries(dir: string) {
  return (await readdir(dir, { withFileTypes: true }))
    .filter((entry) => entry.name !== "node_modules" && entry.name !== ".git")
    .map((entry) => {
      const full = join(dir, entry.name);
      const info = statSync(full);
      return {
        name: entry.name,
        isDir: entry.isDirectory(),
        size: info.size,
        modified: info.mtime.toISOString(),
      };
    });
}

async function fileMeta(file: string) {
  const info = await stat(file);
  return {
    path: file,
    size: info.size,
    modified: info.mtime.toISOString(),
    mimeType: mimeFromPath(file),
    language: extname(file).slice(1),
    binary: !isText(file),
  };
}

function fileWatch(reply: FastifyReply, file: string) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (event: unknown) =>
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        );
      send({ type: "ready" });
      const watcher = watch(file, () =>
        send({ type: "change", at: Date.now() }),
      );
      setTimeout(() => {
        watcher.close();
        controller.close();
      }, 300_000);
    },
  });
  return reply.header("Content-Type", "text/event-stream").send(stream);
}

async function workspaceEntries(
  deps: Deps,
  projectId: string,
  workspaceId: string,
  path = "",
) {
  const root = await workspaceRoot(deps, projectId, workspaceId);
  const dir = resolveInside(root, path || ".");
  return (await fileEntries(dir)).map((entry: any) => ({
    name: entry.name,
    path: relative(root, join(dir, entry.name)),
    type: entry.isDir ? "directory" : "file",
    isDir: entry.isDir,
    size: entry.size,
    modified: entry.modified,
  }));
}

async function readWorkspaceFile(root: string, path = ".") {
  const file = resolveInside(root, path);
  const info = await stat(file);
  const mimeType = mimeFromPath(file);
  if (!isText(file) || info.size > 2 * 1024 * 1024)
    return { path, size: info.size, binary: true, mimeType, content: "" };
  return {
    path,
    size: info.size,
    binary: false,
    mimeType,
    content: await readFile(file, "utf8"),
    truncated: false,
  };
}

async function writeWorkspaceFile(
  reply: FastifyReply,
  root: string,
  path = "",
  body: Buffer,
  query: any,
) {
  if (!path) return reply.code(400).send({ error: "path required" });
  const file = resolveInside(root, path);
  if (query.overwrite === "false" && existsSync(file))
    return reply.code(409).send({ error: "File exists" });
  if (query.createDirs !== "false")
    await mkdir(dirname(file), { recursive: true });
  await writeFile(file, body);
  return { path, size: body.length, written: true };
}

async function deleteWorkspaceFile(root: string, path = "") {
  const file = resolveInside(root, path);
  const existed = existsSync(file);
  if (existed) await rm(file, { force: true });
  return { path, existed, deleted: existed };
}

async function moveWorkspaceFile(
  root: string,
  fromPath = "",
  toPath = "",
  overwrite = false,
) {
  const from = resolveInside(root, fromPath);
  const to = resolveInside(root, toPath);
  if (!overwrite && existsSync(to)) throw new Error("Target exists");
  await mkdir(dirname(to), { recursive: true });
  await rename(from, to);
  return { fromPath, toPath, moved: true };
}

async function workspaceRoot(
  deps: Deps,
  projectId: string,
  workspaceId: string,
) {
  const project = await requireProject(projectId, deps.defaultCwd);
  if (workspaceId === "root") return project.path;
  return Buffer.from(workspaceId, "base64url").toString("utf8");
}

async function listProjects(defaultCwd: string): Promise<StoredProject[]> {
  const stored = (await readJson(projectsPath(), [])) as StoredProject[];
  const fallback = projectFromPath(defaultCwd);
  return stored.some((project) => project.path === fallback.path)
    ? stored
    : [fallback, ...stored];
}

async function addProject(
  input: { name?: string; path?: string; create?: boolean },
  defaultCwd: string,
) {
  const path = resolve(expandHome(input.path || defaultCwd));
  if (input.create) await mkdir(path, { recursive: true });
  if (!statSync(path).isDirectory())
    throw new Error("Project path must be a directory");
  const projects = (await readJson(projectsPath(), [])) as StoredProject[];
  const project = {
    ...projectFromPath(path),
    name: input.name || basename(path) || path,
  };
  await writeJson(projectsPath(), [
    project,
    ...projects.filter((item) => item.id !== project.id),
  ]);
  return project;
}

async function removeProject(projectId: string) {
  const projects = (await readJson(projectsPath(), [])) as StoredProject[];
  await writeJson(
    projectsPath(),
    projects.filter((project) => project.id !== projectId),
  );
  return true;
}

async function requireProject(projectId: string, defaultCwd: string) {
  const project = (await listProjects(defaultCwd)).find(
    (item) => item.id === projectId,
  );
  if (!project) throw new Error("Project not found");
  return project;
}

function projectFromPath(path: string): StoredProject {
  return {
    id: Buffer.from(path).toString("base64url"),
    name: basename(path) || path,
    path,
    createdAt: new Date().toISOString(),
  };
}

async function workspacesFor(project: StoredProject) {
  const workspaces = [
    {
      id: "root",
      projectId: project.id,
      path: project.path,
      label: basename(project.path) || project.path,
      isMain: true,
      isGitRepo: existsSync(join(project.path, ".git")),
      isGitWorktree: false,
    },
  ];
  const result = await runCommand(
    "git",
    ["-C", project.path, "worktree", "list", "--porcelain"],
    project.path,
    5000,
  ).catch(() => ({ output: "" }));
  for (const match of result.output.matchAll(/^worktree (.+)$/gm)) {
    const path = match[1];
    if (path !== project.path)
      workspaces.push({
        id: Buffer.from(path).toString("base64url"),
        projectId: project.id,
        path,
        label: basename(path),
        isMain: false,
        isGitRepo: true,
        isGitWorktree: true,
      });
  }
  return workspaces;
}

async function directorySuggestions(q: string) {
  const base =
    q.startsWith("/") || q.startsWith("~") ? dirname(expandHome(q)) : homedir();
  const needle = basename(q).toLowerCase();
  const entries = existsSync(base)
    ? await readdir(base, { withFileTypes: true })
    : [];
  return {
    directories: entries
      .filter(
        (entry) =>
          entry.isDirectory() && entry.name.toLowerCase().includes(needle),
      )
      .slice(0, 20)
      .map((entry) => join(base, entry.name)),
  };
}

async function listSuggestions(cwd: string, query: string, pathsOnly: boolean) {
  const dir = query.includes("/") ? resolveInside(cwd, dirname(query)) : cwd;
  const needle = basename(query).toLowerCase();
  const entries = existsSync(dir)
    ? await readdir(dir, { withFileTypes: true })
    : [];
  const files = entries
    .filter((entry) => entry.name.toLowerCase().includes(needle))
    .slice(0, 50)
    .map((entry) => ({
      path: relative(cwd, join(dir, entry.name)),
      name: entry.name,
      type: entry.isDirectory() ? "directory" : "file",
    }));
  return pathsOnly ? { paths: files.map((file) => file.path) } : { files };
}

async function gitStatus(cwd: string) {
  const result = await runCommand(
    "git",
    ["-C", cwd, "status", "--short", "--branch"],
    cwd,
    8000,
  );
  return {
    clean:
      result.output.trim() === "## " || result.output.trim().endsWith("clean"),
    output: result.output,
    files: result.output.split("\n").filter(Boolean),
  };
}

async function gitDiff(cwd: string, path?: string, staged?: boolean) {
  const args = [
    "-C",
    cwd,
    "diff",
    ...(staged ? ["--staged"] : []),
    ...(path ? ["--", path] : []),
  ];
  const result = await runCommand("git", args, cwd, 8000);
  return { diff: result.output };
}

function attachTerminalSocket(socket: any, terminalId: string) {
  const detach = terminalManager.attach(terminalId, {
    output: (data, replay) =>
      socket.send(JSON.stringify({ type: "output", data, replay })),
    exit: (exitCode) => socket.send(JSON.stringify({ type: "exit", exitCode })),
  });
  socket.on("message", (raw: Buffer | string) => {
    const msg = JSON.parse(raw.toString());
    if (msg.type === "input") terminalManager.write(terminalId, msg.data);
    if (msg.type === "resize")
      terminalManager.resize(terminalId, msg.cols, msg.rows);
  });
  socket.on("close", detach);
}

async function listMachines() {
  return [
    { id: "local", name: "Local", kind: "local", url: "local" },
    ...((await readJson(machinesPath(), [])) as StoredMachine[]),
  ];
}
async function getMachine(id: string) {
  return (await listMachines()).find((machine: any) => machine.id === id);
}
async function updateMachine(id: string, patch: Partial<StoredMachine>) {
  const machines = (await readJson(machinesPath(), [])) as StoredMachine[];
  const index = machines.findIndex((machine) => machine.id === id);
  if (index < 0) return undefined;
  machines[index] = { ...machines[index], ...patch };
  await writeJson(machinesPath(), machines);
  return machines[index];
}
async function deleteMachine(id: string) {
  const machines = (await readJson(machinesPath(), [])) as StoredMachine[];
  await writeJson(
    machinesPath(),
    machines.filter((machine) => machine.id !== id),
  );
  return true;
}

async function runCommand(
  cmd: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
) {
  return new Promise<{ code: number | null; output: string }>((resolve) => {
    const child = spawn(cmd, args, { cwd, env: process.env });
    let output = "";
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on("data", (chunk) => (output += chunk.toString()));
    child.stderr.on("data", (chunk) => (output += chunk.toString()));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: 1, output: error.message });
    });
  });
}

async function readJson(path: string, fallback: any) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}
async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}
function piWebDir() {
  return resolve(process.env.PI_WEB_DATA_DIR ?? join(homedir(), ".pi-web"));
}
function projectsPath() {
  return resolve(
    process.env.PI_WEB_PROJECTS_FILE ?? join(piWebDir(), "projects.json"),
  );
}
function machinesPath() {
  return resolve(
    process.env.PI_WEB_MACHINES_FILE ?? join(piWebDir(), "machines.json"),
  );
}
function configPath() {
  return resolve(
    process.env.PI_WEB_CONFIG ??
      join(
        process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
        "pi-web",
        "config.json",
      ),
  );
}
function modelsConfigPath() {
  return join(getAgentDir(), "models.json");
}
function expandHome(path: string) {
  return path === "~" || path.startsWith("~/")
    ? join(homedir(), path.slice(2))
    : path;
}
function isText(path: string) {
  return ![
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".pdf",
    ".zip",
    ".gz",
    ".tar",
    ".wasm",
    ".mp3",
    ".wav",
    ".ogg",
  ].includes(extname(path).toLowerCase());
}
function mimeFromPath(path: string) {
  const ext = extname(path).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".wav") return "audio/wav";
  return "text/plain; charset=utf-8";
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function escapeHtml(value: string) {
  return value.replace(
    /[&<>"]/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]!,
  );
}
