import { describe, expect, it } from "vitest";
import { messageKey } from "./ChatPane";
import { appendTerminalOutput } from "./TerminalPane";

describe("messageKey", () => {
  it("uses stable message identifiers when present", () => {
    expect(
      messageKey({ role: "assistant", id: "abc", content: "one" }, 4),
    ).toBe("assistant:abc");
  });

  it("derives a non-index-only fallback from message content", () => {
    const key = messageKey({ role: "user", content: "hello" }, 2);
    expect(key).toMatch(/^user:[a-z0-9]+:2$/);
    expect(key).not.toBe("2");
  });
});

describe("appendTerminalOutput", () => {
  it("keeps short terminal output unchanged", () => {
    expect(appendTerminalOutput("$ echo hi\n", "hi\n", 100)).toBe(
      "$ echo hi\nhi\n",
    );
  });

  it("trims old terminal output and keeps recent complete lines", () => {
    const output = appendTerminalOutput(
      "old line\n".repeat(10),
      "new line\nlast line\n",
      64,
    );
    expect(output).toMatch(/^\[trimmed older terminal output\]\n/);
    expect(output).toContain("new line\nlast line\n");
    expect(output.length).toBeLessThanOrEqual(64);
  });

  it("never exceeds tiny custom limits", () => {
    expect(appendTerminalOutput("abcdef", "ghij", 4)).toBe("ghij");
    expect(appendTerminalOutput("abcdef", "ghij", 0)).toBe("");
    expect(appendTerminalOutput("abcdef", "ghij", Number.NaN)).toBe("");
  });
});
