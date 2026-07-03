import { describe, expect, it } from "vitest";
import { messageKey } from "./ChatPane";

describe("messageKey", () => {
  it("uses stable message identifiers when present", () => {
    expect(messageKey({ role: "assistant", id: "abc", content: "one" })).toBe(
      "assistant:abc",
    );
  });

  it("uses content instead of array position for messages without ids", () => {
    const message = { role: "user", content: "hello" };

    expect(messageKey(message)).toMatch(/^user:[a-z0-9]+$/);
    expect(messageKey(message)).not.toBe("user:0");
  });
});
