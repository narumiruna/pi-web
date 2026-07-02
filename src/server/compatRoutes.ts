// biome-ignore-all lint: compatibility routes intentionally accept third-party wire shapes.
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
import { configPath, expandHome, writeJson } from "./compatShared.js";
import type { CompatDeps as Deps } from "./compatTypes.js";

export function registerCompatRoutes(app: FastifyInstance, deps: Deps) {
  addBinaryParsers(app);
  registerUtilityRoutes(app, deps);
  registerAuthRoutes(app);
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
