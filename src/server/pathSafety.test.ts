import { describe, expect, it } from "vitest";
import { resolveInside } from "./pathSafety.js";

describe("resolveInside", () => {
  it("allows paths inside the root", () => {
    expect(resolveInside("/tmp/project", "src/file.ts")).toBe(
      "/tmp/project/src/file.ts",
    );
  });

  it("blocks parent traversal", () => {
    expect(() => resolveInside("/tmp/project", "../secret")).toThrow(/escapes/);
  });
});
