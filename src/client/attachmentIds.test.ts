import { describe, expect, it } from "vitest";
import { createAttachmentId } from "./attachmentIds";

describe("attachment ids", () => {
  it("creates unique compact ids suitable for React keys", () => {
    const first = createAttachmentId();
    const second = createAttachmentId();

    expect(first).not.toBe(second);
    expect(first.length).toBeLessThan(64);
    expect(second.length).toBeLessThan(64);
  });
});
