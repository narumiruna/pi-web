import { describe, expect, it } from "vitest";
import { messageKey } from "./ChatPane";

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
});
