import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { workspaceRoot } from "./compatFiles.js";

const idFor = (path: string) => Buffer.from(path).toString("base64url");

describe("compat workspace root", () => {
  it("decodes absolute root workspace ids inside the default cwd", () => {
    expect(workspaceRoot("/tmp", idFor("/tmp/project"), "root")).toBe(
      resolve("/tmp/project"),
    );
  });

  it("rejects malformed, relative, empty, nul-containing, and outside ids", () => {
    expect(workspaceRoot("/tmp", "not valid", "root")).toBeUndefined();
    expect(workspaceRoot("/tmp", idFor("relative"), "root")).toBeUndefined();
    expect(workspaceRoot("/tmp", "_", "root")).toBeUndefined();
    expect(
      workspaceRoot("/tmp", idFor("/tmp/\0project"), "root"),
    ).toBeUndefined();
    expect(
      workspaceRoot("/tmp/allowed", idFor("/tmp/other"), "root"),
    ).toBeUndefined();
  });
});
