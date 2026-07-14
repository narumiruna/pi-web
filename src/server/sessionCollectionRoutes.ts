import type { FastifyInstance } from "fastify";
import { toolsForPermissionProfile } from "./productCore.js";
import { requireWorkspaceCwd } from "./sessionScope.js";

type SessionCollection = {
  id: string;
  cwd: string;
  inner: { sessionFile?: string };
  status: () => unknown;
};

type SessionCollectionDeps = {
  defaultCwd: string;
  listSessions: () => Promise<unknown[]>;
  startSession: (
    cwd: string,
    sessionFile?: string,
    toolNames?: string[],
  ) => Promise<SessionCollection>;
};

function jsonError(error: unknown): { error: string } {
  return { error: error instanceof Error ? error.message : String(error) };
}

export function registerSessionCollectionRoutes(
  app: FastifyInstance,
  deps: SessionCollectionDeps,
) {
  app.get("/api/sessions", async (_request, reply) => {
    try {
      return { sessions: await deps.listSessions() };
    } catch (error) {
      return reply.code(500).send(jsonError(error));
    }
  });

  app.post<{
    Body: { cwd?: string; toolNames?: string[]; permissionProfile?: string };
  }>("/api/sessions", async (request, reply) => {
    try {
      const cwd = requireWorkspaceCwd(request.body?.cwd, deps.defaultCwd);
      const toolNames = toolsForPermissionProfile(
        request.body?.permissionProfile,
        request.body?.toolNames,
      );
      const session = await deps.startSession(cwd, undefined, toolNames);
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
  });
}
