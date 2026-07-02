// biome-ignore-all lint: compatibility routes intentionally accept third-party wire shapes.
import { existsSync, statSync } from "node:fs";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import {
  AuthStorage,
  buildSessionContext,
  ModelRegistry,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { FastifyInstance, FastifyReply } from "fastify";
import { escapeHtml } from "./compatShared.js";
import type { CompatDeps as Deps, Json } from "./compatTypes.js";

const archiveDirName = ".pi-web-archived-sessions";

export function registerSessionCompatRoutes(app: FastifyInstance, deps: Deps) {
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

export function registerAgentCompatRoutes(app: FastifyInstance, deps: Deps) {
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
