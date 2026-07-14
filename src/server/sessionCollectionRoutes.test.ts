import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerSessionCollectionRoutes } from "./sessionCollectionRoutes.js";

const defaultCwd = "/workspace/project";

function webSession(cwd = defaultCwd) {
  return {
    id: "session-1",
    cwd,
    inner: { sessionFile: "/sessions/session-1.jsonl" },
    status: () => ({ sessionId: "session-1", cwd }),
  };
}

function setup() {
  const listSessions = vi.fn(async () => [
    { id: "session-1", cwd: defaultCwd },
  ]);
  const startSession = vi.fn(async (cwd: string) => webSession(cwd));
  const app = Fastify();
  registerSessionCollectionRoutes(app, {
    defaultCwd,
    listSessions,
    startSession,
  });
  return { app, listSessions, startSession };
}

describe("session collection routes", () => {
  it("returns the server-scoped session list", async () => {
    const { app, listSessions } = setup();

    const response = await app.inject({ method: "GET", url: "/api/sessions" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      sessions: [{ id: "session-1", cwd: defaultCwd }],
    });
    expect(listSessions).toHaveBeenCalledOnce();
  });

  it.each([
    ["an omitted cwd", undefined],
    ["an equivalent cwd", `${defaultCwd}/.`],
  ])("creates a startup-workspace session for %s", async (_label, cwd) => {
    const { app, startSession } = setup();

    const response = await app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: cwd === undefined ? {} : { cwd },
    });

    expect(response.statusCode).toBe(200);
    expect(startSession).toHaveBeenCalledWith(defaultCwd, undefined, undefined);
    expect(response.json().session).toMatchObject({
      id: "session-1",
      cwd: defaultCwd,
    });
  });

  it("rejects session creation outside the startup workspace", async () => {
    const { app, startSession } = setup();

    const response = await app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: { cwd: "/workspace/other" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "Session cwd must match the startup workspace",
    });
    expect(startSession).not.toHaveBeenCalled();
  });

  it.each([
    ["an array body", [], "Request body must be an object"],
    ["a numeric cwd", { cwd: 42 }, "Session cwd must be a string"],
    [
      "invalid tool names",
      { toolNames: ["bash", 42] },
      "toolNames must be an array of strings",
    ],
    [
      "a non-string permission profile",
      { permissionProfile: 42 },
      "permissionProfile must be a string",
    ],
  ])("rejects %s", async (_label, payload, error) => {
    const { app, startSession } = setup();

    const response = await app.inject({
      method: "POST",
      url: "/api/sessions",
      payload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error });
    expect(startSession).not.toHaveBeenCalled();
  });

  it("rejects a JSON null body", async () => {
    const { app, startSession } = setup();

    const response = await app.inject({
      method: "POST",
      url: "/api/sessions",
      headers: { "content-type": "application/json" },
      payload: "null",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "Request body must be an object",
    });
    expect(startSession).not.toHaveBeenCalled();
  });
});
