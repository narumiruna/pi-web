import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ExtensionSyncRegistry,
  isLoopbackAddress,
  isValidSyncedSessionFile,
  parseSyncMessage,
  sanitizeSyncedStatusData,
  sendOrReportSynced,
  stringArray,
} from "./extensionSync.js";

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
      sessionName: "Synced",
      cwd: "/work",
      synced: true,
      connected: true,
      isStreaming: true,
    });
    expect(seen.at(-1)).toMatchObject({
      type: "status",
      status: { sessionId: "session-1", isStreaming: true },
    });

    registry.disconnect("session-1", "second");
    expect(registry.get("session-1")).toBe(first);
    expect(first.connected).toBe(false);
    expect(first.send({ type: "prompt", text: "hi" })).toBe(false);
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

  it("keeps an old session when a connection moves to another session", () => {
    const registry = new ExtensionSyncRegistry();
    const disconnected: unknown[] = [];
    const reconnected: unknown[] = [];
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

    expect(registry.get("session-1")).toBe(first);
    expect(first.connected).toBe(false);
    expect(registry.get("session-2")?.status()).toMatchObject({
      sessionId: "session-2",
      cwd: "/two",
      connected: true,
    });
    expect(disconnected).toContainEqual({
      type: "sync_disconnected",
      sessionId: "session-1",
    });

    first.on((event) => reconnected.push(event));
    expect(
      registry.connect(
        { type: "hello", sessionId: "session-1", cwd: "/one" },
        collect([]),
        {},
      ),
    ).toBe(first);
    expect(reconnected.at(-1)).toMatchObject({
      type: "status",
      status: { sessionId: "session-1", connected: true },
    });
  });

  it("reports when a control event is not sent", () => {
    const registry = new ExtensionSyncRegistry();
    const events: unknown[] = [];
    const session = registry.connect(
      { type: "hello", sessionId: "session-1", cwd: "/work" },
      () => false,
      "connection",
    );
    session.on((event) => events.push(event));

    expect(sendOrReportSynced(session, { type: "prompt", text: "hi" })).toBe(
      false,
    );
    expect(events.at(-1)).toEqual({
      type: "session_error",
      message: "Pi extension disconnected",
    });
  });

  it("evicts disconnected sessions after subscribers leave", () => {
    const registry = new ExtensionSyncRegistry();
    const session = registry.connect(
      { type: "hello", sessionId: "session-1", cwd: "/work" },
      collect([]),
      "connection",
    );
    const unsubscribe = session.on(() => undefined);

    registry.disconnect("session-1", "connection");
    expect(registry.get("session-1")).toBe(session);
    expect(session.hasSubscribers).toBe(true);

    unsubscribe();
    expect(registry.get("session-1")).toBeUndefined();

    registry.connect(
      { type: "hello", sessionId: "session-2", cwd: "/work" },
      collect([]),
      "second",
    );
    registry.disconnect("session-2", "second");
    expect(registry.get("session-2")).toBeUndefined();
  });
});

describe("isLoopbackAddress", () => {
  it("accepts loopback addresses only", () => {
    expect(isLoopbackAddress("127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("::1")).toBe(true);
    expect(isLoopbackAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("10.0.0.2")).toBe(false);
  });
});

describe("isValidSyncedSessionFile", () => {
  it("accepts existing files inside the agent directory only", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-agent-"));
    const sessions = join(root, "sessions");
    const dotted = join(root, "..cache");
    await mkdir(sessions);
    await mkdir(dotted);
    const inside = join(sessions, "session.jsonl");
    const insideDotted = join(dotted, "session.jsonl");
    const outside = join(await mkdtemp(join(tmpdir(), "pi-web-outside-")), "x");
    await writeFile(inside, "", "utf8");
    await writeFile(insideDotted, "", "utf8");
    await writeFile(outside, "", "utf8");

    expect(isValidSyncedSessionFile(inside, root)).toBe(true);
    expect(isValidSyncedSessionFile(insideDotted, root)).toBe(true);
    expect(isValidSyncedSessionFile(outside, root)).toBe(false);
    expect(isValidSyncedSessionFile(join(root, "missing.jsonl"), root)).toBe(
      false,
    );
  });
});

describe("parseSyncMessage", () => {
  it("requires an object with a string type", () => {
    expect(parseSyncMessage('{"type":"status","status":{}}')).toEqual({
      type: "status",
      status: {},
    });
    expect(() => parseSyncMessage("null")).toThrow(
      "Invalid pi-web sync message",
    );
    expect(() => parseSyncMessage("[]")).toThrow("Invalid pi-web sync message");
    expect(() => parseSyncMessage("{}")).toThrow("Invalid pi-web sync message");
  });
});

describe("sanitizeSyncedStatusData", () => {
  it("keeps only validated session files", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-agent-"));
    const inside = join(root, "session.jsonl");
    const outside = join(await mkdtemp(join(tmpdir(), "pi-web-outside-")), "x");
    await writeFile(inside, "", "utf8");
    await writeFile(outside, "", "utf8");

    expect(sanitizeSyncedStatusData({ sessionFile: inside }, root)).toEqual({
      sessionFile: inside,
    });
    expect(sanitizeSyncedStatusData({ sessionFile: outside }, root)).toEqual(
      {},
    );
    expect(sanitizeSyncedStatusData({ sessionFile: 1 }, root)).toEqual({});
  });
});

describe("stringArray", () => {
  it("keeps only strings", () => {
    expect(stringArray(["read", 1, "bash", null])).toEqual(["read", "bash"]);
    expect(stringArray("read")).toEqual([]);
  });
});
