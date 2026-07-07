import { describe, expect, it } from "vitest";
import { splitPatchIntoHunks } from "./diffHunks";

const PATCH = [
  "diff --git a/file.txt b/file.txt",
  "index 5626abf..f719efd 100644",
  "--- a/file.txt",
  "+++ b/file.txt",
  "@@ -1 +1 @@",
  "-one",
  "+two",
  "diff --git a/other.txt b/other.txt",
  "index 1111111..2222222 100644",
  "--- a/other.txt",
  "+++ b/other.txt",
  "@@ -1 +1 @@",
  "-three",
  "+four",
  "@@ -10 +10 @@",
  "-five",
  "+six",
].join("\n");

describe("splitPatchIntoHunks", () => {
  it("splits multi-file patches into standalone hunk patches", () => {
    const hunks = splitPatchIntoHunks(PATCH);
    expect(hunks.map((hunk) => hunk.path)).toEqual([
      "file.txt",
      "other.txt",
      "other.txt",
    ]);
    expect(hunks[0].patch).toContain("--- a/file.txt");
    expect(hunks[0].patch).toContain("-one");
    expect(hunks[2].header).toBe("@@ -10 +10 @@");
    expect(hunks[2].patch).not.toContain("-three");
  });

  it("returns nothing for empty or hunk-less patches", () => {
    expect(splitPatchIntoHunks("")).toEqual([]);
    expect(
      splitPatchIntoHunks("diff --git a/bin b/bin\nBinary files differ\n"),
    ).toEqual([]);
  });
});
