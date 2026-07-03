// biome-ignore-all lint: compatibility routes intentionally accept third-party wire shapes.
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  AuthStorage,
  DefaultResourceLoader,
  getAgentDir,
  ModelRegistry,
  parseFrontmatter,
} from "@earendil-works/pi-coding-agent";
import type { FastifyInstance } from "fastify";
import { registerFileCompatRoutes } from "./compatFiles.js";
import { registerSessionCompatRoutes } from "./compatSessions.js";
import type { CompatDeps as Deps } from "./compatTypes.js";

export function registerCompatRoutes(app: FastifyInstance, deps: Deps) {
  addBinaryParsers(app);
  registerAuthRoutes(app, deps);
  registerSkillRoutes(app);
  registerSessionCompatRoutes(app, deps);
  registerFileCompatRoutes(app, deps);
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

function registerAuthRoutes(app: FastifyInstance, deps: Deps) {
  app.get("/api/auth/all-providers", async () => providerResponse());
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
}
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

function providerResponse() {
  const auth = AuthStorage.create();
  const registry = ModelRegistry.create(auth);
  const models = registry.getAll();
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
