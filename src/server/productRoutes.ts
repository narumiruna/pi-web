// biome-ignore-all lint: Fastify route bodies are local JSON feature payloads.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import type { CompatDeps } from "./compatTypes.js";
import {
  createCheckpoint,
  createDraftPr,
  createWorktree,
  deleteTask,
  diagnostics,
  discoverInstructionFiles,
  gitDiff,
  importIssue,
  listBookmarks,
  listCheckpoints,
  listTasks,
  listWorktrees,
  loadGoldenTasks,
  permissionSettings,
  productDataDir,
  readInstructionFile,
  readJson,
  readMcpConfig,
  removeWorktree,
  restoreInstructionFile,
  restoreMcpConfig,
  revertGitChange,
  reviewEvaluation,
  rewindCheckpoint,
  runGoldenTask,
  runProcess,
  runValidation,
  safeReplayPath,
  saveBookmark,
  saveInstructionFile,
  saveMcpServer,
  saveTask,
  searchSessions,
  writeJson,
} from "./productCore.js";

function jsonError(error: unknown): { error: string } {
  return { error: error instanceof Error ? error.message : String(error) };
}

function cwdOrDefault(value: string | undefined, deps: CompatDeps) {
  return resolve(value || deps.defaultCwd);
}

export function registerProductRoutes(app: FastifyInstance, deps: CompatDeps) {
  app.get<{ Querystring: { cwd?: string } }>(
    "/api/git/diff",
    async (request, reply) => {
      try {
        return await gitDiff(cwdOrDefault(request.query.cwd, deps));
      } catch (error) {
        return reply.code(400).send(jsonError(error));
      }
    },
  );

  app.post<{ Body: { cwd?: string; path?: string; patch?: string } }>(
    "/api/git/revert",
    async (request, reply) => {
      try {
        return await revertGitChange(
          cwdOrDefault(request.body?.cwd, deps),
          request.body ?? {},
        );
      } catch (error) {
        return reply.code(400).send(jsonError(error));
      }
    },
  );

  app.get<{ Querystring: { cwd?: string; sessionId?: string } }>(
    "/api/checkpoints",
    async (request) => ({
      checkpoints: await listCheckpoints({
        cwd: request.query.cwd,
        sessionId: request.query.sessionId,
      }),
    }),
  );

  app.post<{ Body: { cwd?: string; sessionId?: string } }>(
    "/api/checkpoints",
    async (request, reply) => {
      try {
        return {
          checkpoint: await createCheckpoint(
            cwdOrDefault(request.body?.cwd, deps),
            request.body?.sessionId,
          ),
        };
      } catch (error) {
        return reply.code(400).send(jsonError(error));
      }
    },
  );

  app.post<{ Params: { id: string }; Body: { confirmDelete?: boolean } }>(
    "/api/checkpoints/:id/rewind",
    async (request, reply) => {
      try {
        return await rewindCheckpoint(request.params.id, {
          confirmDelete: request.body?.confirmDelete,
        });
      } catch (error) {
        return reply.code(400).send(jsonError(error));
      }
    },
  );

  app.post<{ Body: { cwd?: string; command?: string } }>(
    "/api/validation/run",
    async (request, reply) => {
      try {
        if (!request.body?.command)
          return reply.code(400).send({ error: "command is required" });
        return await runValidation(
          cwdOrDefault(request.body.cwd, deps),
          request.body.command,
        );
      } catch (error) {
        return reply.code(400).send(jsonError(error));
      }
    },
  );

  app.get<{ Querystring: { cwd?: string } }>(
    "/api/worktrees",
    async (request) => ({
      worktrees: await listWorktrees(cwdOrDefault(request.query.cwd, deps)),
    }),
  );

  app.post<{ Body: { cwd?: string; title?: string } }>(
    "/api/worktrees",
    async (request, reply) => {
      try {
        return await createWorktree(
          cwdOrDefault(request.body?.cwd, deps),
          request.body?.title,
        );
      } catch (error) {
        return reply.code(400).send(jsonError(error));
      }
    },
  );

  app.delete<{ Body: { cwd?: string; path?: string; force?: boolean } }>(
    "/api/worktrees",
    async (request, reply) => {
      try {
        if (!request.body?.path)
          return reply.code(400).send({ error: "path is required" });
        return await removeWorktree(
          cwdOrDefault(request.body.cwd, deps),
          request.body.path,
          Boolean(request.body.force),
        );
      } catch (error) {
        return reply.code(400).send(jsonError(error));
      }
    },
  );

  app.post<{ Body: { cwd?: string; issue?: string } }>(
    "/api/issues/import",
    async (request, reply) => {
      try {
        if (!request.body?.issue)
          return reply.code(400).send({ error: "issue is required" });
        return await importIssue(
          request.body.issue,
          cwdOrDefault(request.body.cwd, deps),
        );
      } catch (error) {
        return reply.code(400).send(jsonError(error));
      }
    },
  );

  app.post<{
    Body: {
      cwd?: string;
      title?: string;
      summary?: string;
      testing?: string;
      draft?: boolean;
    };
  }>("/api/pr/create", async (request, reply) => {
    try {
      return await createDraftPr(
        cwdOrDefault(request.body?.cwd, deps),
        request.body ?? {},
      );
    } catch (error) {
      return reply.code(400).send(jsonError(error));
    }
  });

  app.get("/api/mcp", async () => ({
    config: await readMcpConfig(),
    note: "Pi has no built-in MCP; pi-web stores extension-facing stdio config only.",
  }));
  app.post<{ Body: { name?: string; server?: Record<string, unknown> } }>(
    "/api/mcp",
    async (request, reply) => {
      try {
        if (!request.body?.name || !request.body.server)
          return reply
            .code(400)
            .send({ error: "name and server are required" });
        return {
          config: await saveMcpServer(request.body.name, request.body.server),
        };
      } catch (error) {
        return reply.code(400).send(jsonError(error));
      }
    },
  );
  app.post("/api/mcp/restore", async (_request, reply) => {
    try {
      return { config: await restoreMcpConfig() };
    } catch (error) {
      return reply.code(400).send(jsonError(error));
    }
  });
  app.delete<{ Body: { name?: string } }>(
    "/api/mcp",
    async (request, reply) => {
      try {
        if (!request.body?.name)
          return reply.code(400).send({ error: "name is required" });
        return { config: await saveMcpServer(request.body.name, null) };
      } catch (error) {
        return reply.code(400).send(jsonError(error));
      }
    },
  );
  app.post<{ Body: { command?: string; args?: string[]; cwd?: string } }>(
    "/api/mcp/test",
    async (request, reply) => {
      try {
        if (!request.body?.command)
          return reply.code(400).send({ error: "command is required" });
        const result = await runProcess(
          request.body.command,
          request.body.args ?? ["--version"],
          { cwd: cwdOrDefault(request.body.cwd, deps), timeoutMs: 10_000 },
        );
        return {
          ok: result.code === 0,
          code: result.code,
          output: result.output,
        };
      } catch (error) {
        return reply.code(400).send(jsonError(error));
      }
    },
  );

  app.get<{ Querystring: { cwd?: string; path?: string } }>(
    "/api/instructions",
    async (request, reply) => {
      try {
        const cwd = cwdOrDefault(request.query.cwd, deps);
        if (request.query.path)
          return await readInstructionFile(cwd, request.query.path);
        return { files: await discoverInstructionFiles(cwd) };
      } catch (error) {
        return reply.code(400).send(jsonError(error));
      }
    },
  );
  app.patch<{
    Body: { cwd?: string; path?: string; content?: string; restore?: boolean };
  }>("/api/instructions", async (request, reply) => {
    try {
      if (!request.body?.path)
        return reply.code(400).send({ error: "path is required" });
      const cwd = cwdOrDefault(request.body.cwd, deps);
      return request.body.restore
        ? await restoreInstructionFile(cwd, request.body.path)
        : await saveInstructionFile(
            cwd,
            request.body.path,
            request.body.content ?? "",
          );
    } catch (error) {
      return reply.code(400).send(jsonError(error));
    }
  });

  app.get("/api/permissions", async () => permissionSettings());
  app.post<{ Body: { profile?: string } }>(
    "/api/permissions",
    async (request) => permissionSettings(request.body?.profile),
  );

  app.get<{ Querystring: { q?: string } }>(
    "/api/search/sessions",
    async (request) => ({
      results: await searchSessions(request.query.q ?? ""),
    }),
  );
  app.get("/api/bookmarks", async () => ({ bookmarks: await listBookmarks() }));
  app.post<{ Body: Record<string, unknown> }>(
    "/api/bookmarks",
    async (request) => ({ bookmarks: await saveBookmark(request.body ?? {}) }),
  );

  app.get("/api/tasks", async () => ({ tasks: await listTasks() }));
  app.post<{ Body: Record<string, unknown> }>(
    "/api/tasks",
    async (request) => ({ task: await saveTask(request.body ?? {}) }),
  );
  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    "/api/tasks/:id",
    async (request) => ({
      task: await saveTask({ ...request.body, id: request.params.id }),
    }),
  );
  app.delete<{ Params: { id: string } }>("/api/tasks/:id", async (request) => ({
    tasks: await deleteTask(request.params.id),
  }));

  app.get<{ Querystring: { cwd?: string } }>(
    "/api/diagnostics",
    async (request) => diagnostics(cwdOrDefault(request.query.cwd, deps)),
  );

  app.get("/api/golden-tasks", async () => ({
    tasks: await loadGoldenTasks(),
  }));
  app.post<{ Body: { file?: string; agent?: boolean } }>(
    "/api/evaluations/run",
    async (request, reply) => {
      try {
        if (!request.body?.file)
          return reply.code(400).send({ error: "file is required" });
        const promptRunner = request.body.agent
          ? async (task: { prompt: string }, cwd: string) => {
              const session = await deps.startSession(cwd);
              await session.inner.prompt(task.prompt, { source: "rpc" });
              const status = session.status();
              return {
                tokens:
                  Number(status?.tokens?.input ?? 0) +
                  Number(status?.tokens?.output ?? 0),
                cost: Number(status?.cost ?? 0),
                sessionId: String(status?.sessionId ?? ""),
              };
            }
          : undefined;
        return {
          result: await runGoldenTask(request.body.file, promptRunner),
        };
      } catch (error) {
        return reply.code(400).send(jsonError(error));
      }
    },
  );
  app.post<{ Params: { id: string }; Body: { review?: string } }>(
    "/api/evaluations/:id/review",
    async (request, reply) => {
      try {
        return {
          result: await reviewEvaluation(
            request.params.id,
            request.body?.review ?? "",
          ),
        };
      } catch (error) {
        return reply.code(400).send(jsonError(error));
      }
    },
  );
  app.get("/api/evaluations", async () => ({
    results: await readJson(`${productDataDir()}/evaluations.json`, []),
  }));

  app.get<{ Querystring: { path?: string } }>(
    "/api/replay",
    async (request, reply) => {
      try {
        if (!request.query.path)
          return reply.code(400).send({ error: "path is required" });
        const path = safeReplayPath(request.query.path);
        return JSON.parse(await readFile(path, "utf8"));
      } catch (error) {
        return reply.code(400).send(jsonError(error));
      }
    },
  );
}
