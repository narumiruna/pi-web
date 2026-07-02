// biome-ignore-all lint: compatibility routes intentionally accept third-party wire shapes.
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  AuthStorage,
  DefaultPackageManager,
  DefaultResourceLoader,
  getAgentDir,
  ModelRegistry,
  parseFrontmatter,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { FastifyInstance, FastifyReply } from "fastify";
import {
  listSuggestions,
  registerFileCompatRoutes,
  registerProjectRoutes,
} from "./compatFiles.js";
import {
  registerAgentCompatRoutes,
  registerSessionCompatRoutes,
} from "./compatSessions.js";
import {
  configPath,
  errorMessage,
  expandHome,
  machinesPath,
  mimeFromPath,
  modelsConfigPath,
  piWebDir,
  readJson,
  runCommand,
  writeJson,
} from "./compatShared.js";
import type { CompatDeps as Deps, Json, StoredMachine } from "./compatTypes.js";
import { resolveInside } from "./pathSafety.js";
import { TerminalManager } from "./terminalManager.js";

const terminalManager = new TerminalManager();
const loginCallbacks = new Map<
  string,
  { resolve: (value: string) => void; reject: (error: Error) => void }
>();

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
  registerProjectRoutes(app, deps, (cwd) => terminalManager.list(cwd));
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
