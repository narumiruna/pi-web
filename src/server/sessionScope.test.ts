import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  filterSessionsForWorkspace,
  isSessionInWorkspace,
  requireWorkspaceCwd,
} from "./sessionScope.js";

type TestSession = { id: string; cwd?: unknown };

const workspace = resolve("/workspace/project");

function session(id: string, cwd?: unknown): TestSession {
  return { id, cwd };
}

describe("workspace session scope", () => {
  it("matches only an exact normalized workspace path", () => {
    expect(isSessionInWorkspace(session("exact", workspace), workspace)).toBe(
      true,
    );
    expect(
      isSessionInWorkspace(
        session("normalized", `${workspace}/nested/..`),
        workspace,
      ),
    ).toBe(true);
    expect(
      isSessionInWorkspace(session("sibling", `${workspace}-other`), workspace),
    ).toBe(false);
    expect(
      isSessionInWorkspace(session("child", `${workspace}/nested`), workspace),
    ).toBe(false);
  });

  it("rejects sessions without a usable cwd", () => {
    expect(isSessionInWorkspace(session("missing"), workspace)).toBe(false);
    expect(isSessionInWorkspace(session("empty", ""), workspace)).toBe(false);
    expect(isSessionInWorkspace(session("invalid", 42), workspace)).toBe(false);
    expect(isSessionInWorkspace(null, workspace)).toBe(false);
    expect(isSessionInWorkspace("invalid", workspace)).toBe(false);
  });

  it("filters without changing the order of matching sessions", () => {
    const sessions = [
      session("foreign", "/workspace/other"),
      session("first", workspace),
      session("child", `${workspace}/child`),
      session("second", `${workspace}/.`),
    ];

    expect(
      filterSessionsForWorkspace(sessions, workspace).map((item) => item.id),
    ).toEqual(["first", "second"]);
  });

  it("accepts omitted or equivalent requested cwd values", () => {
    expect(requireWorkspaceCwd(undefined, workspace)).toBe(workspace);
    expect(requireWorkspaceCwd(`${workspace}/.`, workspace)).toBe(workspace);
  });

  it("rejects a requested cwd outside the startup workspace", () => {
    expect(() => requireWorkspaceCwd("/workspace/other", workspace)).toThrow(
      "Session cwd must match the startup workspace",
    );
  });

  it.each([
    null,
    42,
    {},
    [],
  ])("rejects a non-string requested cwd: %j", (requestedCwd) => {
    expect(() => requireWorkspaceCwd(requestedCwd, workspace)).toThrow(
      "Session cwd must be a string",
    );
  });
});
