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

function requestBody(value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Request body must be an object");
  return value as Record<string, unknown>;
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`${name} must be a string`);
  return value;
}

function optionalStringArray(
  value: unknown,
  name: string,
): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
    throw new Error(`${name} must be an array of strings`);
  return value;
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

  app.post<{ Body: unknown }>("/api/sessions", async (request, reply) => {
    try {
      const body = requestBody(request.body);
      const cwd = requireWorkspaceCwd(body.cwd, deps.defaultCwd);
      const toolNames = toolsForPermissionProfile(
        optionalString(body.permissionProfile, "permissionProfile"),
        optionalStringArray(body.toolNames, "toolNames"),
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
