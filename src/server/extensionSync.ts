import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

export type SyncJson = Record<string, unknown>;

type ControlSender = (event: SyncJson) => boolean;
type SyncSocket = {
  readyState: number;
  send(data: string): void;
  on(event: "message", listener: (raw: Buffer | string) => void): void;
  on(event: "close", listener: () => void): void;
};

function isRecord(value: unknown): value is SyncJson {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export class ExtensionSyncedSession {
  private readonly listeners = new Set<(event: SyncJson) => void>();
  private control?: ControlSender;
  private connection?: unknown;
  private statusData: SyncJson = {};

  constructor(readonly id: string) {}

  get sessionFile() {
    return typeof this.statusData.sessionFile === "string"
      ? this.statusData.sessionFile
      : undefined;
  }

  connect(hello: SyncJson, control: ControlSender, connection: unknown) {
    this.control = control;
    this.connection = connection;
    this.statusData = { ...this.statusData, ...this.metadata(hello) };
    this.broadcastStatus();
  }

  disconnect(connection: unknown) {
    if (this.connection !== connection) return false;
    this.control = undefined;
    this.connection = undefined;
    this.broadcast({ type: "sync_disconnected", sessionId: this.id });
    return true;
  }

  on(listener: (event: SyncJson) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  send(event: SyncJson) {
    return this.control?.(event) ?? false;
  }

  receive(event: SyncJson) {
    if (event.type === "status" && isRecord(event.status)) {
      this.statusData = { ...this.statusData, ...event.status };
      this.broadcastStatus();
      return;
    }
    this.broadcast(event);
  }

  broadcast(event: SyncJson) {
    for (const listener of this.listeners) listener(event);
  }

  status(): SyncJson {
    return {
      isStreaming: false,
      isCompacting: false,
      pendingMessageCount: 0,
      ...this.statusData,
      sessionFile: this.sessionFile,
      sessionName:
        typeof this.statusData.sessionName === "string"
          ? this.statusData.sessionName
          : undefined,
      cwd: typeof this.statusData.cwd === "string" ? this.statusData.cwd : "",
      sessionId: this.id,
      synced: true,
    };
  }

  private broadcastStatus() {
    this.broadcast({ type: "status", status: this.status() });
  }

  private metadata(message: SyncJson) {
    const metadata: SyncJson = {};
    for (const key of [
      "sessionFile",
      "sessionName",
      "cwd",
      "model",
      "thinkingLevel",
      "contextUsage",
      "activeTools",
      "tools",
      "commands",
    ]) {
      if (message[key] !== undefined) metadata[key] = message[key];
    }
    if (isRecord(message.status)) Object.assign(metadata, message.status);
    return metadata;
  }
}

export function registerExtensionSyncRoutes(
  app: FastifyInstance,
  registry: ExtensionSyncRegistry,
  onSessionFile: (sessionId: string, sessionFile: string) => void,
) {
  app.get(
    "/api/sync/pi-extension",
    { websocket: true },
    (socket: SyncSocket) => {
      const connection = {};
      let sessionId: string | undefined;
      const send = (event: SyncJson) => {
        if (socket.readyState !== 1) return false;
        socket.send(JSON.stringify(event));
        return true;
      };

      socket.on("message", (raw: Buffer | string) => {
        try {
          const message = JSON.parse(raw.toString()) as SyncJson;
          if (message.type === "hello") {
            const synced = registry.connect(message, send, connection);
            sessionId = synced.id;
            if (synced.sessionFile)
              onSessionFile(synced.id, synced.sessionFile);
            return;
          }
          if (!sessionId) return;
          registry.get(sessionId)?.receive(message);
        } catch (error) {
          send({
            type: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      });

      socket.on("close", () => {
        if (sessionId) registry.disconnect(sessionId, connection);
      });
    },
  );
}

export function sendSyncedEvents(
  request: FastifyRequest,
  reply: FastifyReply,
  synced: ExtensionSyncedSession,
) {
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (event: SyncJson) =>
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        );
      send({
        type: "connected",
        sessionId: synced.id,
        status: synced.status(),
      });
      const unsubscribe = synced.on(send);
      const heartbeat = setInterval(
        () => controller.enqueue(encoder.encode(":\n\n")),
        30_000,
      );
      request.raw.on("close", () => {
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
  });
  return reply
    .header("Content-Type", "text/event-stream")
    .header("Cache-Control", "no-cache")
    .send(stream);
}

export class ExtensionSyncRegistry {
  private readonly sessions = new Map<string, ExtensionSyncedSession>();
  private readonly connections = new Map<unknown, string>();

  connect(message: SyncJson, control: ControlSender, connection: unknown) {
    if (message.type !== "hello" || typeof message.sessionId !== "string") {
      throw new Error("Invalid pi-web sync hello");
    }
    const previousId = this.connections.get(connection);
    if (previousId && previousId !== message.sessionId) {
      this.disconnect(previousId, connection);
    }
    const session =
      this.sessions.get(message.sessionId) ??
      new ExtensionSyncedSession(message.sessionId);
    this.sessions.set(message.sessionId, session);
    this.connections.set(connection, message.sessionId);
    session.connect(message, control, connection);
    return session;
  }

  get(id: string) {
    return this.sessions.get(id);
  }

  disconnect(id: string, connection: unknown) {
    const session = this.sessions.get(id);
    if (!session?.disconnect(connection)) return;
    this.sessions.delete(id);
    if (this.connections.get(connection) === id)
      this.connections.delete(connection);
  }
}
