// biome-ignore-all lint: compatibility routes intentionally accept third-party wire shapes.
import { existsSync, statSync } from "node:fs";
import { unlink } from "node:fs/promises";
import {
  buildSessionContext,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { FastifyInstance } from "fastify";
import { escapeHtml } from "./compatShared.js";
import type { CompatDeps as Deps } from "./compatTypes.js";
import { sessionExport } from "./productCore.js";

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
      const liveSession = deps.liveSessions.get(request.params.id);
      const file = await deps.resolveSessionPath(request.params.id);
      if (!file && !liveSession)
        return reply.code(404).send({ error: "Session not found" });
      liveSession?.dispose?.();
      deps.liveSessions.delete(request.params.id);
      if (file) await unlink(file);
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
  app.get<{ Params: { id: string }; Querystring: { format?: string } }>(
    "/api/sessions/:id/export",
    async (request, reply) => {
      const current = await sessionManagerFor(deps, request.params.id);
      if (!current) return reply.code(404).send({ error: "Session not found" });
      const messages = contextWithEntryIds(current.manager).messages;
      if (request.query.format === "json" || request.query.format === "md") {
        const format = request.query.format;
        return reply
          .header(
            "Content-Type",
            format === "json"
              ? "application/json; charset=utf-8"
              : "text/markdown; charset=utf-8",
          )
          .header(
            "Content-Disposition",
            `attachment; filename="${request.params.id}.${format}"`,
          )
          .send(sessionExport(messages, format));
      }
      return reply
        .header("Content-Type", "text/html; charset=utf-8")
        .header(
          "Content-Disposition",
          `attachment; filename="${request.params.id}.html"`,
        )
        .send(transcriptHtml(messages));
    },
  );
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

async function sessionState(deps: Deps, id: string) {
  try {
    return (await deps.getLiveSession(id)).status();
  } catch {
    return { isStreaming: false };
  }
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
