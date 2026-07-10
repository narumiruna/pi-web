import { describe, expect, it } from "vitest";
import { groupMessagesForDisplay, messageKey } from "./ChatPane";

describe("messageKey", () => {
  it("uses stable message identifiers when present", () => {
    expect(messageKey({ role: "assistant", id: "abc", content: "one" })).toBe(
      "assistant:abc",
    );
  });

  it("uses content plus position for messages without ids", () => {
    const message = { role: "user", content: "hello" };

    expect(messageKey(message, 2)).toMatch(/^user:[a-z0-9]+:2$/);
    expect(messageKey(message, 2)).not.toBe("user:2");
    expect(messageKey(message, 3)).not.toBe(messageKey(message, 2));
  });

  it("keeps a fallback key when content cannot be stringified", () => {
    const content: Record<string, unknown> = { count: 1n };
    content.self = content;

    expect(messageKey({ role: "assistant", content }, 1)).toMatch(
      /^assistant:[a-z0-9]+:1$/,
    );
  });
});

describe("groupMessagesForDisplay", () => {
  it("collapses contiguous tool output into one activity group", () => {
    expect(
      groupMessagesForDisplay([
        { role: "user", content: "run it" },
        { role: "toolResult", toolName: "read", content: "one" },
        { role: "toolResult", toolName: "bash", content: "two" },
        { role: "assistant", content: "done" },
      ]),
    ).toEqual([
      { kind: "message", indexes: [0], hasError: false },
      { kind: "activity", indexes: [1, 2], hasError: false },
      { kind: "message", indexes: [3], hasError: false },
    ]);
  });

  it("groups tool-only assistant turns with their results", () => {
    expect(
      groupMessagesForDisplay([
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "checking" },
            { type: "toolCall", name: "read", arguments: {} },
          ],
        },
        { role: "toolResult", toolName: "read", content: "done" },
        { role: "assistant", content: [{ type: "text", text: "Summary" }] },
      ]),
    ).toEqual([
      { kind: "activity", indexes: [0, 1], hasError: false },
      { kind: "message", indexes: [2], hasError: false },
    ]);
  });

  it("isolates errors so disclosure does not expand routine activity", () => {
    expect(
      groupMessagesForDisplay([
        { role: "toolResult", content: "ok" },
        { role: "toolResult", isError: true, content: "failed" },
        { role: "toolResult", content: "recovered" },
      ]),
    ).toEqual([
      { kind: "activity", indexes: [0], hasError: false },
      { kind: "activity", indexes: [1], hasError: true },
      { kind: "activity", indexes: [2], hasError: false },
    ]);
  });
});
