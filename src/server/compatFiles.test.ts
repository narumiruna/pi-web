import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { workspaceRoot } from "./compatFiles.js";

const idFor = (path: string) => Buffer.from(path).toString("base64url");

describe("compat workspace root", () => {
  it("decodes absolute root workspace ids", () => {
    expect(workspaceRoot(idFor("/tmp/project"), "root")).toBe(
      resolve("/tmp/project"),
    );
  });

  it("rejects malformed, relative, empty, and nul-containing ids", () => {
    expect(workspaceRoot("not valid", "root")).toBeUndefined();
    expect(workspaceRoot(idFor("relative"), "root")).toBeUndefined();
    expect(workspaceRoot("_", "root")).toBeUndefined();
    expect(workspaceRoot(idFor("/tmp/\0project"), "root")).toBeUndefined();
  });
});
