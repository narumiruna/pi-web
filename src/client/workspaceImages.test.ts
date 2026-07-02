import { describe, expect, it } from "vitest";
import {
  parseWorkspaceImageMarkdown,
  workspaceImageUrl,
} from "./workspaceImages";

describe("workspace image markdown", () => {
  it("parses workspace image tokens", () => {
    expect(
      parseWorkspaceImageMarkdown("see ![diagram](workspace://docs/a.svg) ok"),
    ).toEqual([
      { type: "text", text: "see " },
      { type: "workspaceImage", alt: "diagram", path: "docs/a.svg" },
      { type: "text", text: " ok" },
    ]);

    expect(
      parseWorkspaceImageMarkdown("![img](workspace://path/to.png)"),
    ).toEqual([{ type: "workspaceImage", alt: "img", path: "path/to.png" }]);
  });

  it("ignores non-workspace image URLs", () => {
    expect(
      parseWorkspaceImageMarkdown("![x](https://example.com/a.png)"),
    ).toEqual([{ type: "text", text: "![x](https://example.com/a.png)" }]);
  });

  it("builds the safe server URL", () => {
    expect(workspaceImageUrl("/tmp/work space", "docs/a b.svg")).toBe(
      "/api/files/image?cwd=%2Ftmp%2Fwork%20space&path=docs%2Fa%20b.svg",
    );
  });
});
