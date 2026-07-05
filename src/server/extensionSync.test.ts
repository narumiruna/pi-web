import { describe, expect, it } from "vitest";
import { ExtensionSyncRegistry } from "./extensionSync.js";

function collect(events: unknown[]) {
  return (event: unknown) => {
    events.push(event);
    return true;
  };
}

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
      collect(firstControl),
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
      collect(secondControl),
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

  it("does not let untrusted status payloads override normalized fields", () => {
    const registry = new ExtensionSyncRegistry();
    const session = registry.connect(
      { type: "hello", sessionId: "session-1", cwd: "/work" },
      collect([]),
      "connection",
    );

    session.receive({
      type: "status",
      status: { sessionFile: 1, sessionName: {}, cwd: false },
    });

    expect(session.status()).toMatchObject({
      sessionId: "session-1",
      sessionFile: undefined,
      sessionName: undefined,
      cwd: "",
    });
  });

  it("disconnects an old session when a connection moves to another session", () => {
    const registry = new ExtensionSyncRegistry();
    const disconnected: unknown[] = [];
    const connection = {};
    const first = registry.connect(
      { type: "hello", sessionId: "session-1", cwd: "/one" },
      collect([]),
      connection,
    );
    first.on((event) => disconnected.push(event));

    registry.connect(
      { type: "hello", sessionId: "session-2", cwd: "/two" },
      collect([]),
      connection,
    );

    expect(registry.get("session-1")).toBeUndefined();
    expect(registry.get("session-2")?.status()).toMatchObject({
      sessionId: "session-2",
      cwd: "/two",
    });
    expect(disconnected).toContainEqual({
      type: "sync_disconnected",
      sessionId: "session-1",
    });
  });

  it("reports when a control event is not sent", () => {
    const registry = new ExtensionSyncRegistry();
    const session = registry.connect(
      { type: "hello", sessionId: "session-1", cwd: "/work" },
      () => false,
      "connection",
    );

    expect(session.send({ type: "prompt", text: "hi" })).toBe(false);
  });
});
