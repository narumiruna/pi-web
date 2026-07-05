// biome-ignore-all lint: Pi SDK extension and websocket surfaces are intentionally dynamic here.
import { chmodSync, existsSync, watch } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AuthStorage,
  buildSessionContext,
  createAgentSession,
  getAgentDir,
  ModelRegistry,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import Fastify, { type FastifyReply } from "fastify";
import * as pty from "node-pty";
import { registerCompatRoutes } from "./compatRoutes.js";
import {
  ExtensionSyncRegistry,
  registerExtensionSyncRoutes,
  sendSyncedEvents,
  stringArray,
} from "./extensionSync.js";
import { imageMimeFromPath, isTextPath, mimeFromPath } from "./fileTypes.js";
import { resolveInside } from "./pathSafety.js";
import { DEFAULT_PORT, isAddressInUse, portCandidates } from "./ports.js";
import { readWorkspaceImage } from "./workspaceImages.js";

type LiveSession = Awaited<ReturnType<typeof createAgentSession>>["session"];
type Json = Record<string, unknown>;

const nodeRequire = createRequire(import.meta.url);
const PATH_ENV = process.platform === "win32" ? "Path" : "PATH";
const PATH_SEPARATOR = process.platform === "win32" ? ";" : ":";
const LOCAL_BIN_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "node_modules",
  ".bin",
);

const PORT = Number(process.env.PORT ?? DEFAULT_PORT);
const HOST = process.env.HOST ?? "127.0.0.1";
const AUTO_PORT = process.env.PI_WEB_AUTO_PORT === "1";
const DEFAULT_CWD = resolve(
  process.env.PI_WEB_CWD ?? process.env.WORKSPACE_ROOT ?? process.cwd(),
);
const MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024;
const sessionPathCache = new Map<string, string>();
const liveSessions = new Map<string, WebSession>();
const syncSessions = new ExtensionSyncRegistry();

function terminalEnv() {
  const currentPath = process.env[PATH_ENV] ?? process.env.PATH ?? "";
  return {
    ...process.env,
    [PATH_ENV]: [currentPath, LOCAL_BIN_DIR]
      .filter(Boolean)
      .join(PATH_SEPARATOR),
    TERM: "xterm-256color",
  };
}

function ensurePtyHelperExecutable() {
  if (process.platform === "win32") return;
  const nodePtyRoot = resolve(dirname(nodeRequire.resolve("node-pty")), "..");
  for (const helper of [
    join(nodePtyRoot, "build", "Release", "spawn-helper"),
    join(
      nodePtyRoot,
      "prebuilds",
      `${process.platform}-${process.arch}`,
      "spawn-helper",
    ),
  ]) {
    try {
      if (existsSync(helper)) chmodSync(helper, 0o755);
    } catch {
      // node-pty will report the spawn failure if chmod is not allowed.
    }
  }
}

function jsonError(error: unknown): { error: string } {
  return { error: error instanceof Error ? error.message : String(error) };
}

function secureSvg(reply: FastifyReply, mimeType: string) {
  if (mimeType !== "image/svg+xml") return;
  reply
    .header("Content-Security-Policy", "sandbox; default-src 'none'")
    .header("X-Content-Type-Options", "nosniff");
}

function sessionInfo(
  info: Awaited<ReturnType<typeof SessionManager.listAll>>[number],
) {
  sessionPathCache.set(info.id, info.path);
  return {
    id: info.id,
    path: info.path,
    cwd: info.cwd,
    name: info.name,
    created: info.created.toISOString(),
    modified: info.modified.toISOString(),
    messageCount: info.messageCount,
    firstMessage: info.firstMessage,
    parentSessionPath: info.parentSessionPath,
  };
}

async function listSessions() {
  const sessions = await SessionManager.listAll();
  return sessions
    .sort((a, b) => b.modified.getTime() - a.modified.getTime())
    .map(sessionInfo);
}

async function resolveSessionPath(id: string): Promise<string | undefined> {
  const cached = sessionPathCache.get(id);
  if (cached && existsSync(cached)) return cached;
  sessionPathCache.delete(id);
  await listSessions();
  const fresh = sessionPathCache.get(id);
  if (fresh && existsSync(fresh)) return fresh;
  sessionPathCache.delete(id);
  return undefined;
}

function makeUiContext(webSession: WebSession): any {
  const send = (method: string, payload: Json = {}) =>
    webSession.broadcast({ type: "extension_ui", method, ...payload });
  const noop = () => {};
  const uiContext = {
    select: async (_title: string, options: string[]) => options[0],
    confirm: async () => false,
    input: async () => undefined,
    editor: async () => undefined,
    notify: (message: string, notifyType = "info") =>
      send("notify", { message, notifyType }),
    setStatus: (key: string, text?: string) => send("setStatus", { key, text }),
    setWidget: (
      key: string,
      lines?: string[],
      options?: { placement?: string },
    ) => send("setWidget", { key, lines, placement: options?.placement }),
    setTitle: (title: string) => send("setTitle", { title }),
    setEditorText: (text: string) => send("setEditorText", { text }),
    pasteToEditor: (text: string) => send("setEditorText", { text }),
    custom: async () => undefined,
    onTerminalInput: () => noop,
    getEditorText: () => "",
    getAllThemes: () => [],
    getTheme: () => undefined,
    getToolsExpanded: () => false,
    setTheme: () => ({
      success: false,
      error: "Theme switching is not available in pi-web.",
    }),
    get theme() {
      return undefined;
    },
  };
  return new Proxy(uiContext, {
    get(target, prop: string | symbol) {
      if (prop in target) return target[prop as keyof typeof target];
      if (typeof prop === "string" && prop.startsWith("get"))
        return () => undefined;
      return noop;
    },
  });
}

class WebSession {
  private listeners = new Set<(event: Json) => void>();
  private unsubscribe?: () => void;
  private promptRunning = false;
  readonly ready: Promise<void>;

  constructor(readonly inner: LiveSession) {
    this.unsubscribe = inner.subscribe((event) => {
      this.broadcast(event as Json);
      if (
        [
          "agent_start",
          "agent_end",
          "compaction_start",
          "compaction_end",
          "queue_update",
          "thinking_level_changed",
        ].includes((event as Json).type as string)
      ) {
        this.broadcast({ type: "status", status: this.status() });
      }
    });
    this.ready = inner
      .bindExtensions({
        mode: "rpc",
        uiContext: makeUiContext(this),
        onError: (error) =>
          this.broadcast({ type: "extension_error", ...error }),
      } as any)
      .catch((error) => {
        this.broadcast({
          type: "session_error",
          message: error instanceof Error ? error.message : String(error),
        });
      });
  }

  get id() {
    return this.inner.sessionId;
  }
  get cwd() {
    return this.inner.sessionManager.getCwd();
  }

  on(listener: (event: Json) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  broadcast(event: Json) {
    for (const listener of this.listeners) listener(event);
  }

  status() {
    const model = this.inner.model;
    const stats = safe(() => this.inner.getSessionStats());
    return {
      sessionId: this.inner.sessionId,
      sessionFile: this.inner.sessionFile,
      sessionName: this.inner.sessionName,
      cwd: this.cwd,
      isStreaming: this.inner.isStreaming || this.promptRunning,
      isCompacting: this.inner.isCompacting,
      pendingMessageCount: this.inner.pendingMessageCount,
      model: model
        ? {
            provider: model.provider,
            id: model.id,
            name: model.name,
            contextWindow: model.contextWindow,
          }
        : null,
      thinkingLevel: this.inner.thinkingLevel,
      contextUsage: this.inner.getContextUsage() ?? null,
      tokens: stats?.tokens ?? null,
      cost: stats?.cost ?? 0,
      activeTools: this.inner.getActiveToolNames(),
    };
  }

  async prompt(
    text: string,
    images?: any[],
    streamingBehavior?: "steer" | "followUp",
  ) {
    await this.ready;
    if (this.inner.isStreaming && streamingBehavior === "steer") {
      await this.inner.steer(text, images);
      this.broadcast({ type: "status", status: this.status() });
      return;
    }
    if (this.inner.isStreaming && streamingBehavior === "followUp") {
      await this.inner.followUp(text, images);
      this.broadcast({ type: "status", status: this.status() });
      return;
    }

    this.promptRunning = true;
    this.broadcast({ type: "status", status: this.status() });
    void this.inner
      .prompt(text, {
        ...(images?.length ? { images } : {}),
        source: "rpc",
      } as any)
      .catch((error) =>
        this.broadcast({
          type: "session_error",
          message: error instanceof Error ? error.message : String(error),
        }),
      )
      .finally(() => {
        this.promptRunning = false;
        this.broadcast({ type: "prompt_done" });
        this.broadcast({ type: "status", status: this.status() });
      });
  }

  dispose() {
    this.unsubscribe?.();
    this.inner.dispose();
  }
}

function safe<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

async function startSession(
  cwd: string,
  sessionFile?: string,
  toolNames?: string[],
): Promise<WebSession> {
  const sessionManager = sessionFile
    ? SessionManager.open(sessionFile)
    : SessionManager.create(cwd);
  const { session } = await createAgentSession({
    cwd,
    agentDir: getAgentDir(),
    sessionManager,
    ...(toolNames !== undefined ? { tools: toolNames } : {}),
  });
  if (toolNames !== undefined) session.setActiveToolsByName(toolNames);
  const webSession = new WebSession(session);
  liveSessions.set(session.sessionId, webSession);
  if (session.sessionFile)
    sessionPathCache.set(session.sessionId, session.sessionFile);
  return webSession;
}

async function getLiveSession(id: string): Promise<WebSession> {
  const live = liveSessions.get(id);
  if (live) return live;
  const file = await resolveSessionPath(id);
  if (!file) throw new Error("Session not found");
  const manager = SessionManager.open(file);
  return startSession(
    manager.getCwd() || manager.getHeader()?.cwd || DEFAULT_CWD,
    file,
  );
}

function normalizeImages(images: unknown): any[] | undefined {
  if (!Array.isArray(images)) return undefined;
  return images
    .map((image) => {
      if (!image || typeof image !== "object") return undefined;
      const item = image as Record<string, unknown>;
      const data = item.data;
      const mimeType = item.mimeType;
      if (typeof data !== "string" || typeof mimeType !== "string")
        return undefined;
      return { type: "image", data, mimeType };
    })
    .filter(Boolean);
}

function commandList(session: LiveSession) {
  const extensionCommands = (
    session.extensionRunner.getRegisteredCommands() as any[]
  ).map((cmd) => ({
    name: cmd.invocationName ?? cmd.name,
    description: cmd.description,
    source: "extension",
  }));
  const prompts = session.promptTemplates.map((template: any) => ({
    name: template.name,
    description: template.description,
    source: "prompt",
  }));
  const skills = session.resourceLoader
    .getSkills()
    .skills.map((skill: any) => ({
      name: `skill:${skill.name}`,
      description: skill.description,
      source: "skill",
    }));
  return [...extensionCommands, ...prompts, ...skills].filter(
    (cmd) => cmd.name,
  );
}

const app = Fastify({
  logger: true,
  bodyLimit: Number(process.env.PI_WEB_BODY_LIMIT ?? 50 * 1024 * 1024),
});
await app.register(fastifyWebsocket);

registerExtensionSyncRoutes(app, syncSessions, (id, file) =>
  sessionPathCache.set(id, file),
);

app.get("/api/config", async () => ({
  defaultCwd: DEFAULT_CWD,
  agentDir: getAgentDir(),
  config: {},
  effectiveConfig: {
    uploads: { defaultFolder: ".pi-web/uploads" },
    pathAccess: { allowedPaths: [] },
  },
}));

app.get("/api/models", async () => {
  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);
  const models = await modelRegistry.getAvailable();
  const modelList = modelRegistry.getAll().map((model) => ({
    provider: model.provider,
    id: model.id,
    modelId: model.id,
    name: model.name,
    contextWindow: model.contextWindow,
    reasoning: model.reasoning,
  }));
  return {
    models: models.map((model) => ({
      provider: model.provider,
      id: model.id,
      modelId: model.id,
      name: model.name,
      contextWindow: model.contextWindow,
      reasoning: model.reasoning,
    })),
    modelList,
    defaultModel: models[0]
      ? { provider: models[0].provider, modelId: models[0].id }
      : null,
  };
});

app.get("/api/sessions", async (_request, reply) => {
  try {
    return { sessions: await listSessions() };
  } catch (error) {
    return reply.code(500).send(jsonError(error));
  }
});

app.post<{ Body: { cwd?: string; toolNames?: string[] } }>(
  "/api/sessions",
  async (request, reply) => {
    try {
      const cwd = resolve(request.body?.cwd || DEFAULT_CWD);
      const session = await startSession(
        cwd,
        undefined,
        request.body?.toolNames,
      );
      return {
        session: {
          id: session.id,
          path: session.inner.sessionFile,
          cwd: session.cwd,
          created: new Date().toISOString(),
          modified: new Date().toISOString(),
          messageCount: 0,
          firstMessage: "",
        },
        status: session.status(),
      };
    } catch (error) {
      return reply.code(400).send(jsonError(error));
    }
  },
);

app.get<{ Params: { id: string }; Querystring: { leafId?: string } }>(
  "/api/sessions/:id/messages",
  async (request, reply) => {
    try {
      const live = liveSessions.get(request.params.id);
      const file =
        live?.inner.sessionFile ??
        (await resolveSessionPath(request.params.id));
      if (!file) return reply.code(404).send({ error: "Session not found" });
      const manager = SessionManager.open(file);
      const entries = manager.getEntries();
      const context = buildSessionContext(entries as any, request.query.leafId);
      return {
        messages: context.messages,
        leafId: manager.getLeafId(),
        model: context.model,
        thinkingLevel: context.thinkingLevel,
        tree: manager.getTree(),
      };
    } catch (error) {
      return reply.code(500).send(jsonError(error));
    }
  },
);

app.get<{ Params: { id: string } }>(
  "/api/sessions/:id/status",
  async (request, reply) => {
    try {
      const synced = syncSessions.get(request.params.id);
      if (synced) return { running: synced.connected, status: synced.status() };
      const live = liveSessions.get(request.params.id);
      if (live) return { running: true, status: live.status() };
      const file = await resolveSessionPath(request.params.id);
      if (!file) return reply.code(404).send({ error: "Session not found" });
      const manager = SessionManager.open(file);
      return {
        running: false,
        status: {
          sessionId: manager.getSessionId(),
          sessionFile: file,
          sessionName: manager.getSessionName(),
          cwd: manager.getCwd(),
          isStreaming: false,
          isCompacting: false,
          pendingMessageCount: 0,
        },
      };
    } catch (error) {
      return reply.code(500).send(jsonError(error));
    }
  },
);

app.post<{
  Params: { id: string };
  Body: {
    text?: string;
    images?: unknown;
    streamingBehavior?: "steer" | "followUp";
  };
}>("/api/sessions/:id/prompt", async (request, reply) => {
  try {
    const text = request.body?.text;
    if (typeof text !== "string")
      return reply.code(400).send({ error: "text is required" });
    const synced = syncSessions.get(request.params.id);
    if (synced) {
      if (
        !synced.send({
          type: "prompt",
          text,
          images: normalizeImages(request.body?.images),
          streamingBehavior: request.body?.streamingBehavior,
        })
      )
        return reply.code(409).send({ error: "Pi extension disconnected" });
      return { accepted: true, status: synced.status() };
    }
    const session = await getLiveSession(request.params.id);
    await session.prompt(
      text,
      normalizeImages(request.body?.images),
      request.body?.streamingBehavior,
    );
    return { accepted: true, status: session.status() };
  } catch (error) {
    return reply.code(400).send(jsonError(error));
  }
});

app.post<{ Params: { id: string } }>(
  "/api/sessions/:id/abort",
  async (request, reply) => {
    try {
      const synced = syncSessions.get(request.params.id);
      if (synced) {
        if (!synced.send({ type: "abort" }))
          return reply.code(409).send({ error: "Pi extension disconnected" });
        return { aborted: true };
      }
      const session = await getLiveSession(request.params.id);
      await session.inner.abort();
      return { aborted: true };
    } catch (error) {
      return reply.code(400).send(jsonError(error));
    }
  },
);

app.post<{ Params: { id: string }; Body: { instructions?: string } }>(
  "/api/sessions/:id/compact",
  async (request, reply) => {
    try {
      const synced = syncSessions.get(request.params.id);
      if (synced) {
        if (
          !synced.send({
            type: "compact",
            instructions: request.body?.instructions,
          })
        )
          return reply.code(409).send({ error: "Pi extension disconnected" });
        return { result: "queued" };
      }
      const session = await getLiveSession(request.params.id);
      const result = await session.inner.compact(request.body?.instructions);
      return { result };
    } catch (error) {
      return reply.code(400).send(jsonError(error));
    }
  },
);

app.get<{ Params: { id: string } }>(
  "/api/sessions/:id/tools",
  async (request, reply) => {
    try {
      const synced = syncSessions.get(request.params.id);
      if (synced) {
        const status = synced.status();
        const tools = Array.isArray(status.tools) ? status.tools : [];
        return { tools };
      }
      const session = await getLiveSession(request.params.id);
      const active = new Set(session.inner.getActiveToolNames());
      return {
        tools: session.inner.getAllTools().map((tool) => ({
          name: tool.name,
          description: tool.description,
          sourceInfo: tool.sourceInfo,
          active: active.has(tool.name),
        })),
      };
    } catch (error) {
      return reply.code(400).send(jsonError(error));
    }
  },
);

app.post<{ Params: { id: string }; Body: { toolNames?: string[] } }>(
  "/api/sessions/:id/tools",
  async (request, reply) => {
    try {
      const toolNames = stringArray(request.body?.toolNames);
      const synced = syncSessions.get(request.params.id);
      if (synced) {
        if (!synced.send({ type: "setTools", toolNames }))
          return reply.code(409).send({ error: "Pi extension disconnected" });
        return { tools: toolNames };
      }
      const session = await getLiveSession(request.params.id);
      session.inner.setActiveToolsByName(toolNames);
      return { tools: session.inner.getActiveToolNames() };
    } catch (error) {
      return reply.code(400).send(jsonError(error));
    }
  },
);

app.get<{ Params: { id: string } }>(
  "/api/sessions/:id/commands",
  async (request, reply) => {
    try {
      const synced = syncSessions.get(request.params.id);
      if (synced) {
        const commands = synced.status().commands;
        return { commands: Array.isArray(commands) ? commands : [] };
      }
      const session = await getLiveSession(request.params.id);
      await session.ready;
      return { commands: commandList(session.inner) };
    } catch (error) {
      return reply.code(400).send(jsonError(error));
    }
  },
);

app.post<{
  Params: { id: string };
  Body: { provider?: string; modelId?: string };
}>("/api/sessions/:id/model", async (request, reply) => {
  try {
    const provider = request.body?.provider;
    const modelId = request.body?.modelId;
    if (!provider || !modelId)
      return reply
        .code(400)
        .send({ error: "provider and modelId are required" });
    const synced = syncSessions.get(request.params.id);
    if (synced) {
      if (!synced.send({ type: "setModel", provider, modelId }))
        return reply.code(409).send({ error: "Pi extension disconnected" });
      return { status: synced.status() };
    }
    const session = await getLiveSession(request.params.id);
    const model = session.inner.modelRegistry.find(provider, modelId);
    if (!model) return reply.code(404).send({ error: "Model not found" });
    await session.inner.setModel(model);
    return { status: session.status() };
  } catch (error) {
    return reply.code(400).send(jsonError(error));
  }
});

app.post<{ Params: { id: string }; Body: { level?: string } }>(
  "/api/sessions/:id/thinking",
  async (request, reply) => {
    try {
      const level = request.body?.level;
      if (!level) return reply.code(400).send({ error: "level is required" });
      const synced = syncSessions.get(request.params.id);
      if (synced) {
        if (!synced.send({ type: "setThinking", level }))
          return reply.code(409).send({ error: "Pi extension disconnected" });
        return { status: synced.status() };
      }
      const session = await getLiveSession(request.params.id);
      session.inner.setThinkingLevel(level as any);
      return { status: session.status() };
    } catch (error) {
      return reply.code(400).send(jsonError(error));
    }
  },
);

app.get<{ Params: { id: string } }>(
  "/api/sessions/:id/events",
  async (request, reply) => {
    const synced = syncSessions.get(request.params.id);
    if (synced) return sendSyncedEvents(request, reply, synced);

    let session: WebSession;
    try {
      session = await getLiveSession(request.params.id);
    } catch {
      return reply.code(404).send({ error: "Session not found" });
    }

    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        const send = (event: Json) =>
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
          );
        send({
          type: "connected",
          sessionId: session.id,
          status: session.status(),
        });
        const unsubscribe = session.on(send);
        const heartbeat = setInterval(
          () => controller.enqueue(encoder.encode(":\n\n")),
          30_000,
        );
        request.raw.on("close", () => {
          clearInterval(heartbeat);
          unsubscribe();
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        });
      },
    });
    return reply
      .header("Content-Type", "text/event-stream")
      .header("Cache-Control", "no-cache")
      .send(stream);
  },
);

app.get<{ Querystring: { cwd?: string; path?: string } }>(
  "/api/files/tree",
  async (request, reply) => {
    try {
      const cwd = resolve(request.query.cwd || DEFAULT_CWD);
      const dir = resolveInside(cwd, request.query.path || ".");
      const entries = await readdir(dir, { withFileTypes: true });
      return {
        cwd,
        path: relative(cwd, dir),
        entries: entries
          .filter(
            (entry) => entry.name !== "node_modules" && entry.name !== ".git",
          )
          .sort(
            (a, b) =>
              Number(b.isDirectory()) - Number(a.isDirectory()) ||
              a.name.localeCompare(b.name),
          )
          .slice(0, 300)
          .map((entry) => ({
            name: entry.name,
            path: relative(cwd, join(dir, entry.name)),
            type: entry.isDirectory() ? "directory" : "file",
          })),
      };
    } catch (error) {
      return reply.code(400).send(jsonError(error));
    }
  },
);

app.get<{ Querystring: { cwd?: string; path?: string } }>(
  "/api/files/watch",
  async (request, reply) => {
    try {
      const cwd = resolve(request.query.cwd || DEFAULT_CWD);
      const dir = resolveInside(cwd, request.query.path || ".");
      const info = await stat(dir);
      if (!info.isDirectory())
        return reply.code(400).send({ error: "Not a directory" });

      const stream = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          const send = (event: Json) =>
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
            );
          send({ type: "ready", path: relative(cwd, dir) });
          const watcher = watch(
            dir,
            { persistent: false },
            (eventType, filename) =>
              send({
                type: "change",
                eventType,
                filename: String(filename ?? ""),
                at: Date.now(),
              }),
          );
          watcher.on("error", (error) =>
            send({
              type: "error",
              message: error instanceof Error ? error.message : String(error),
            }),
          );
          const heartbeat = setInterval(
            () => controller.enqueue(encoder.encode(":\n\n")),
            30_000,
          );
          request.raw.on("close", () => {
            clearInterval(heartbeat);
            watcher.close();
            try {
              controller.close();
            } catch {
              /* already closed */
            }
          });
        },
      });
      return reply
        .header("Content-Type", "text/event-stream")
        .header("Cache-Control", "no-cache")
        .send(stream);
    } catch (error) {
      return reply.code(400).send(jsonError(error));
    }
  },
);

app.get<{ Querystring: { cwd?: string; path?: string } }>(
  "/api/files/image",
  async (request, reply) => {
    try {
      const cwd = resolve(request.query.cwd || DEFAULT_CWD);
      const image = await readWorkspaceImage(cwd, request.query.path || ".");
      secureSvg(reply, image.mimeType);
      return reply.type(image.mimeType).send(image.data);
    } catch (error) {
      return reply.code(400).send(jsonError(error));
    }
  },
);

app.get<{ Querystring: { cwd?: string; path?: string } }>(
  "/api/files/content",
  async (request, reply) => {
    try {
      const cwd = resolve(request.query.cwd || DEFAULT_CWD);
      const file = resolveInside(cwd, request.query.path || ".");
      const info = await stat(file);
      if (!info.isFile()) return reply.code(400).send({ error: "Not a file" });
      const imageMimeType = imageMimeFromPath(file);
      if (imageMimeType) {
        const image = await readWorkspaceImage(cwd, request.query.path || ".");
        secureSvg(reply, image.mimeType);
        return {
          path: image.path,
          size: image.size,
          binary: false,
          image: true,
          mimeType: image.mimeType,
          content: image.data.toString("base64"),
        };
      }
      const mimeType = mimeFromPath(file);
      if (!isTextPath(file) || info.size > MAX_TEXT_FILE_BYTES) {
        return {
          path: relative(cwd, file),
          size: info.size,
          binary: true,
          content: "",
          mimeType,
        };
      }
      const buffer = await readFile(file);
      return {
        path: relative(cwd, file),
        size: info.size,
        binary: false,
        image: false,
        mimeType,
        content: buffer.toString("utf8"),
      };
    } catch (error) {
      return reply.code(400).send(jsonError(error));
    }
  },
);

app.get<{ Querystring: { cwd?: string } }>(
  "/api/terminal",
  { websocket: true },
  (socket: any, request) => {
    const cwd = resolve(request.query.cwd || DEFAULT_CWD);
    const shell = process.env.PI_WEB_SHELL || "/bin/sh";
    const send = (event: Json) => {
      if (socket.readyState === 1) socket.send(JSON.stringify(event));
    };
    let child: pty.IPty;
    try {
      ensurePtyHelperExecutable();
      child = pty.spawn(shell, [], {
        cols: 80,
        rows: 24,
        cwd,
        env: terminalEnv(),
        name: "xterm-256color",
      });
    } catch (error) {
      send({
        type: "data",
        data: `[terminal failed: ${jsonError(error).error}]\r\n`,
      });
      send({ type: "exit", code: 1 });
      socket.close();
      return;
    }
    child.onData((data) => send({ type: "data", data }));
    child.onExit(({ exitCode }) => send({ type: "exit", code: exitCode }));
    socket.on("message", (raw: Buffer | string) => {
      const text = raw.toString();
      try {
        const msg = JSON.parse(text);
        if (msg.type === "input" && typeof msg.data === "string")
          child.write(msg.data);
        if (msg.type === "resize") {
          const cols = Number(msg.cols);
          const rows = Number(msg.rows);
          if (Number.isFinite(cols) && Number.isFinite(rows))
            child.resize(
              Math.min(500, Math.max(2, Math.floor(cols))),
              Math.min(200, Math.max(1, Math.floor(rows))),
            );
        }
        if (msg.type === "close") child.kill();
      } catch {
        child.write(text);
      }
    });
    socket.on("close", () => child.kill());
  },
);

registerCompatRoutes(app, {
  defaultCwd: DEFAULT_CWD,
  listSessions,
  resolveSessionPath,
  getLiveSession,
  startSession,
  liveSessions,
});

const clientDist = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../client",
);
if (existsSync(clientDist)) {
  await app.register(fastifyStatic, { root: clientDist });
  app.setNotFoundHandler((_request, reply) => reply.sendFile("index.html"));
}

async function listen() {
  const candidates = portCandidates(PORT, AUTO_PORT);
  for (const [index, port] of candidates.entries()) {
    try {
      const address = await app.listen({ port, host: HOST });
      if (port !== PORT)
        app.log.warn(`Port ${PORT} is in use; listening at ${address}`);
      return;
    } catch (error) {
      if (!isAddressInUse(error) || index === candidates.length - 1)
        throw error;
      app.log.warn({ port }, "Port in use; trying next port");
    }
  }
}

await listen();
