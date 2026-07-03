import { describe, expect, it } from "vitest";
import { messageKey } from "./ChatPane";

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
