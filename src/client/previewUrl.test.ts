import { describe, expect, it } from "vitest";
import { previewUrlAllowed } from "./previewUrl";

describe("previewUrlAllowed", () => {
  it("allows localhost urls", () => {
    expect(previewUrlAllowed("http://127.0.0.1:30142")).toBe(true);
    expect(previewUrlAllowed("http://localhost:3000")).toBe(true);
  });

  it("requires confirmation for external urls", () => {
    expect(previewUrlAllowed("https://example.com")).toBe(false);
    expect(previewUrlAllowed("https://example.com", true)).toBe(true);
  });
});
