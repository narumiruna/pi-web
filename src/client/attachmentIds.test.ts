import { afterEach, describe, expect, it, vi } from "vitest";
import { createAttachmentId } from "./attachmentIds";

describe("attachment ids", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates unique compact ids suitable for React keys", () => {
    const first = createAttachmentId();
    const second = createAttachmentId();

    expect(first).not.toBe(second);
    expect(first.length).toBeLessThan(64);
    expect(second.length).toBeLessThan(64);
  });

  it("creates unique ids when randomUUID is unavailable", () => {
    let fillByte = 0;
    vi.stubGlobal("crypto", {
      getRandomValues(values: Uint8Array) {
        values.fill(fillByte);
        fillByte += 1;
        return values;
      },
    });

    const first = createAttachmentId();
    const second = createAttachmentId();

    expect(first).not.toBe(second);
    expect(first.length).toBeLessThan(64);
    expect(second.length).toBeLessThan(64);
  });
});
