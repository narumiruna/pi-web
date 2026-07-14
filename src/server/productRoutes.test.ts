import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import type { CompatDeps } from "./compatTypes.js";
import { registerProductRoutes } from "./productRoutes.js";

function setup() {
  const listSessions = vi.fn(async () => []);
  const deps: CompatDeps = {
    defaultCwd: "/workspace/project",
    listSessions,
    resolveSessionPath: vi.fn(async () => undefined),
    getLiveSession: vi.fn(async () => undefined),
    startSession: vi.fn(async () => undefined),
    liveSessions: new Map(),
  };
  const app = Fastify();
  registerProductRoutes(app, deps);
  return { app, listSessions };
}

describe("product session search route", () => {
  it("does not list sessions when the query is empty", async () => {
    const { app, listSessions } = setup();

    const response = await app.inject({
      method: "GET",
      url: "/api/search/sessions?q=",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ results: [] });
    expect(listSessions).not.toHaveBeenCalled();
  });

  it("rejects repeated query parameters instead of returning a 500", async () => {
    const { app, listSessions } = setup();

    const response = await app.inject({
      method: "GET",
      url: "/api/search/sessions?q=first&q=second",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "q must be a string" });
    expect(listSessions).not.toHaveBeenCalled();
  });
});
