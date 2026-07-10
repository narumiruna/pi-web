import { describe, expect, it } from "vitest";
import { RECENT_CHAT_LIMIT, visibleSidebarSessions } from "./sidebarSessions";
import type { SessionInfo } from "./types";

function session(index: number): SessionInfo {
  return {
    id: String(index),
    cwd: index % 2 ? "/workspace/alpha" : "/workspace/beta",
    created: `2026-07-10T00:${String(index).padStart(2, "0")}:00Z`,
    modified: `2026-07-10T00:${String(index).padStart(2, "0")}:00Z`,
    messageCount: index,
    firstMessage: `Chat ${index}`,
  };
}

describe("visibleSidebarSessions", () => {
  const sessions = Array.from({ length: 20 }, (_, index) => session(index));

  it("shows a bounded recent list by default", () => {
    expect(visibleSidebarSessions(sessions, "", false)).toEqual(
      sessions.slice(0, RECENT_CHAT_LIMIT),
    );
  });

  it("shows all matching chats while filtering", () => {
    const result = visibleSidebarSessions(sessions, "Chat 19", false);

    expect(result.map((item) => item.id)).toEqual(["19"]);
  });

  it("keeps a newly selected chat visible when it falls outside recents", () => {
    const result = visibleSidebarSessions(sessions, "", false, "19");

    expect(result).toHaveLength(RECENT_CHAT_LIMIT);
    expect(result[0]?.id).toBe("19");
  });

  it("shows the full history after explicit expansion", () => {
    expect(visibleSidebarSessions(sessions, "", true)).toHaveLength(20);
  });

  it("matches chat title and workspace", () => {
    expect(
      visibleSidebarSessions(sessions, "beta", false).map((item) => item.id),
    ).toEqual(
      sessions
        .filter((item) => item.cwd.endsWith("beta"))
        .map((item) => item.id),
    );
  });
});
