import { describe, expect, it } from "vitest";
import { ExtensionSyncRegistry } from "./extensionSync.js";

describe("ExtensionSyncRegistry", () => {
  it("keeps subscribers while replacing stale extension connections", () => {
    const registry = new ExtensionSyncRegistry();
    const firstControl: unknown[] = [];
    const secondControl: unknown[] = [];

    const first = registry.connect(
      {
        type: "hello",
        sessionId: "session-1",
        sessionFile: "/tmp/session-1.jsonl",
        cwd: "/work",
      },
      (event) => firstControl.push(event),
      "first",
    );
    const seen: unknown[] = [];
    first.on((event) => seen.push(event));

    const second = registry.connect(
      {
        type: "hello",
        sessionId: "session-1",
        sessionName: "Synced",
        cwd: "/work",
      },
      (event) => secondControl.push(event),
      "second",
    );

    expect(second).toBe(first);
    registry.disconnect("session-1", "first");
    expect(registry.get("session-1")).toBe(first);

    expect(second.send({ type: "prompt", text: "hi" })).toBe(true);
    expect(firstControl).toEqual([]);
    expect(secondControl).toEqual([{ type: "prompt", text: "hi" }]);

    second.receive({ type: "status", status: { isStreaming: true } });
    expect(second.status()).toMatchObject({
      sessionId: "session-1",
      sessionFile: "/tmp/session-1.jsonl",
      sessionName: "Synced",
      cwd: "/work",
      synced: true,
      isStreaming: true,
    });
    expect(seen.at(-1)).toMatchObject({
      type: "status",
      status: { sessionId: "session-1", isStreaming: true },
    });

    registry.disconnect("session-1", "second");
    expect(registry.get("session-1")).toBeUndefined();
  });
});
