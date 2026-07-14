import { describe, expect, it, vi } from "vitest";
import { filterSessionsForWorkspace } from "./sessionScope.js";
import {
  searchScopedSessions,
  searchSessionEntries,
  searchSessions,
} from "./sessionSearch.js";

const entries = (text: string) => [
  {
    type: "message",
    timestamp: "2026-07-14T00:00:00.000Z",
    message: { role: "user", content: text },
  },
];

describe("workspace session search", () => {
  it("finds matching message content", () => {
    expect(searchSessionEntries("a", entries("Needle in A"), "needle")).toEqual(
      [
        expect.objectContaining({
          sessionId: "a",
          messageIndex: 0,
          excerpt: "Needle in A",
        }),
      ],
    );
  });

  it("does not list sessions for an empty query", async () => {
    const listSessions = vi.fn(async () => []);

    expect(await searchScopedSessions("   ", listSessions)).toEqual([]);
    expect(listSessions).not.toHaveBeenCalled();
  });

  it("opens and searches only sessions already selected by workspace scope", async () => {
    const workspace = "/workspace/a";
    const sessions = filterSessionsForWorkspace(
      [
        {
          id: "a",
          path: "/sessions/a.jsonl",
          cwd: workspace,
          modified: "2026-07-14T00:00:00.000Z",
        },
        {
          id: "b",
          path: "/sessions/b.jsonl",
          cwd: "/workspace/b",
          modified: "2026-07-14T00:00:00.000Z",
        },
      ],
      workspace,
    );
    const open = vi.fn((path: string) => ({
      getEntries: () =>
        entries(
          path.endsWith("a.jsonl") ? "shared needle A" : "shared needle B",
        ),
    }));

    const results = await searchSessions("needle", sessions, open);

    expect(results.map((result) => result.sessionId)).toEqual(["a"]);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith("/sessions/a.jsonl");
  });
});
