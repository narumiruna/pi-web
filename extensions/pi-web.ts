// biome-ignore-all lint: pi extension and WebSocket protocol surfaces are intentionally dynamic.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const DEFAULT_PORT = 30141;
const HOST = "127.0.0.1";
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export default function piWebExtension(pi: ExtensionAPI) {
  let serviceUrl = "";
  let syncEnabled = false;
  let socket: any;
  let reconnectTimer: NodeJS.Timeout | undefined;
  let currentCtx: any;

  pi.registerCommand("pi-web", {
    description: "Start pi-web and live-sync this session",
    handler: async (args, ctx) => {
      currentCtx = ctx;
      const port = parsePort(args);
      ctx.ui.setStatus("pi-web", "pi-web: starting");
      serviceUrl = await ensureService(ctx.cwd, port);
      syncEnabled = true;
      await connectSync(ctx);
      ctx.ui.setStatus("pi-web", `pi-web: ${serviceUrl}`);
      ctx.ui.notify(`pi-web running at ${serviceUrl}`, "info");
    },
  });

  pi.on("session_start", (_event, ctx) => {
    currentCtx = ctx;
    if (syncEnabled) void connectSync(ctx).catch(() => undefined);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    syncEnabled = false;
    clearReconnect();
    socket?.close?.();
    socket = undefined;
    ctx.ui.setStatus("pi-web", undefined);
  });

  pi.on("agent_start", (_event, ctx) => {
    currentCtx = ctx;
    send({ type: "agent_start" });
    sendStatus(ctx);
  });

  pi.on("message_update", (event, ctx) => {
    currentCtx = ctx;
    send({
      type: "message_update",
      assistantMessageEvent: (event as any).assistantMessageEvent,
    });
  });

  pi.on("tool_execution_start", (event, ctx) => {
    currentCtx = ctx;
    send({
      type: "tool_execution_start",
      toolCallId: (event as any).toolCallId,
      toolName: (event as any).toolName,
      args: (event as any).args,
    });
  });

  pi.on("tool_execution_update", (event, ctx) => {
    currentCtx = ctx;
    send({
      type: "tool_execution_update",
      toolCallId: (event as any).toolCallId,
      toolName: (event as any).toolName,
      partialResult: (event as any).partialResult,
    });
  });

  pi.on("tool_execution_end", (event, ctx) => {
    currentCtx = ctx;
    send({
      type: "tool_execution_end",
      toolCallId: (event as any).toolCallId,
      toolName: (event as any).toolName,
      result: (event as any).result,
      isError: (event as any).isError,
    });
  });

  pi.on("agent_end", (_event, ctx) => {
    currentCtx = ctx;
    send({ type: "agent_end" });
    send({ type: "prompt_done" });
    sendStatus(ctx);
  });

  pi.on("session_info_changed", (_event, ctx) => sendStatus(ctx));
  pi.on("model_select", (_event, ctx) => sendStatus(ctx));
  pi.on("thinking_level_select", (_event, ctx) => sendStatus(ctx));

  async function ensureService(cwd: string, port: number) {
    const url = `http://${HOST}:${port}`;
    if (await serviceReady(url, 300)) return url;

    const command = serviceCommand();
    const child = spawn(
      command.command,
      [
        ...command.args,
        "--hostname",
        HOST,
        "--port",
        String(port),
        "--cwd",
        cwd,
      ],
      {
        cwd: command.cwd,
        detached: true,
        env: { ...process.env, HOST, PORT: String(port), PI_WEB_CWD: cwd },
        stdio: "ignore",
      },
    );
    child.unref();

    if (!(await serviceReady(url, 10_000))) {
      throw new Error(`pi-web did not start at ${url}`);
    }
    return url;
  }

  async function connectSync(ctx: any) {
    if (!syncEnabled || !serviceUrl) return;
    const WebSocketCtor = (globalThis as any).WebSocket;
    if (!WebSocketCtor)
      throw new Error("This Node.js runtime has no WebSocket");
    if (socket?.readyState === 0 || socket?.readyState === 1) {
      sendHello(ctx);
      return;
    }

    await new Promise<void>((resolvePromise, reject) => {
      let settled = false;
      const ws = new WebSocketCtor(
        `${serviceUrl.replace(/^http/, "ws")}/api/sync/pi-extension`,
      );
      socket = ws;
      const timeout = setTimeout(
        () => finish(() => reject(new Error("pi-web sync timed out"))),
        3_000,
      );
      timeout.unref?.();

      const finish = (done: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        done();
      };

      ws.addEventListener("open", () => {
        sendHello(ctx);
        finish(resolvePromise);
      });
      ws.addEventListener("message", (event: any) => {
        void handleControl(readSocketData(event.data), currentCtx ?? ctx);
      });
      ws.addEventListener("close", () => {
        if (socket === ws) socket = undefined;
        if (syncEnabled) scheduleReconnect(currentCtx ?? ctx);
      });
      ws.addEventListener("error", () => {
        try {
          ws.close();
        } catch {
          // ignore close errors
        }
        finish(() => reject(new Error("pi-web sync failed")));
      });
    });
  }

  async function handleControl(raw: string, ctx: any) {
    if (!raw) return;
    const message = JSON.parse(raw);
    if (message.type === "prompt" && typeof message.text === "string") {
      const content = promptContent(message.text, message.images);
      const options = ctx.isIdle?.()
        ? undefined
        : {
            deliverAs:
              message.streamingBehavior === "steer" ? "steer" : "followUp",
          };
      pi.sendUserMessage(content, options);
    }
    if (message.type === "abort") ctx.abort?.();
    if (message.type === "compact") {
      ctx.compact?.({
        customInstructions:
          typeof message.instructions === "string"
            ? message.instructions
            : undefined,
        onComplete: () => sendStatus(ctx),
        onError: (error: Error) => ctx.ui.notify(error.message, "error"),
      });
    }
    if (message.type === "setTools" && Array.isArray(message.toolNames)) {
      pi.setActiveTools(
        message.toolNames.filter((name: unknown) => typeof name === "string"),
      );
    }
    if (
      message.type === "setModel" &&
      typeof message.provider === "string" &&
      typeof message.modelId === "string"
    ) {
      const model = ctx.modelRegistry.find(message.provider, message.modelId);
      if (model) await pi.setModel(model);
    }
    if (message.type === "setThinking" && typeof message.level === "string") {
      pi.setThinkingLevel(message.level as any);
    }
    sendStatus(ctx);
  }

  function sendHello(ctx: any) {
    const status = buildStatus(ctx);
    if (!status?.sessionId) return;
    send({ type: "hello", ...status, status });
  }

  function sendStatus(ctx: any) {
    const status = buildStatus(ctx);
    if (status?.sessionId) send({ type: "status", status });
  }

  function buildStatus(ctx: any) {
    const sessionManager = ctx.sessionManager as any;
    const sessionFile = safe(() => sessionManager.getSessionFile?.());
    const sessionId = safe(() => sessionManager.getSessionId?.());
    const activeTools = safe(() => pi.getActiveTools()) ?? [];
    const active = new Set(activeTools);
    const model = (ctx as any).model;
    return {
      sessionId,
      sessionFile,
      sessionName:
        safe(() => pi.getSessionName()) ??
        safe(() => sessionManager.getSessionName?.()),
      cwd: safe(() => sessionManager.getCwd?.()) ?? ctx.cwd,
      isStreaming: ctx.isIdle ? !ctx.isIdle() : false,
      isCompacting: false,
      pendingMessageCount: ctx.hasPendingMessages?.() ? 1 : 0,
      model: model
        ? {
            provider: model.provider,
            id: model.id,
            name: model.name,
            contextWindow: model.contextWindow,
          }
        : null,
      thinkingLevel: safe(() => pi.getThinkingLevel()),
      contextUsage: safe(() => ctx.getContextUsage?.()) ?? null,
      activeTools,
      tools:
        safe(() => pi.getAllTools())?.map((tool: any) => ({
          name: tool.name,
          description: tool.description,
          sourceInfo: tool.sourceInfo,
          active: active.has(tool.name),
        })) ?? [],
      commands:
        safe(() => pi.getCommands())?.map((command: any) => ({
          name: command.name,
          description: command.description,
          source: command.source,
          sourceInfo: command.sourceInfo,
        })) ?? [],
    };
  }

  function send(message: Record<string, unknown>) {
    if (socket?.readyState === 1) socket.send(JSON.stringify(message));
  }

  function scheduleReconnect(ctx: any) {
    clearReconnect();
    reconnectTimer = setTimeout(
      () => void connectSync(ctx).catch(() => undefined),
      1_000,
    );
    reconnectTimer.unref?.();
  }

  function clearReconnect() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
  }
}

function serviceCommand() {
  const cli = join(packageRoot, "dist", "server", "cli.js");
  if (existsSync(cli))
    return { command: process.execPath, args: [cli], cwd: packageRoot };

  const tsCli = join(packageRoot, "src", "server", "cli.ts");
  const tsx = join(
    packageRoot,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "tsx.cmd" : "tsx",
  );
  if (existsSync(tsCli) && existsSync(tsx)) {
    return { command: tsx, args: [tsCli], cwd: packageRoot };
  }

  throw new Error(
    "Cannot find pi-web server. Run npm run build before /pi-web.",
  );
}

async function serviceReady(url: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  do {
    try {
      const response = await fetch(`${url}/api/config`);
      if (response.ok) return true;
    } catch {
      // service is not ready yet
    }
    await delay(150);
  } while (Date.now() < deadline);
  return false;
}

function parsePort(args = "") {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  const flag = parts.findIndex((part) => part === "--port" || part === "-p");
  const value =
    flag >= 0 ? parts[flag + 1] : parts.find((part) => /^\d+$/.test(part));
  const port = value ? Number(value) : DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid pi-web port: ${value}`);
  }
  return port;
}

function promptContent(text: string, images: unknown) {
  if (!Array.isArray(images) || images.length === 0) return text;
  return [
    { type: "text", text },
    ...images.flatMap((image) => {
      if (!image || typeof image !== "object") return [];
      const item = image as any;
      const data = item.data ?? item.source?.data;
      const mimeType =
        item.mimeType ?? item.mediaType ?? item.source?.mediaType;
      if (typeof data !== "string" || typeof mimeType !== "string") return [];
      return [
        {
          type: "image",
          data,
          mimeType,
          source: { type: "base64", mediaType: mimeType, data },
        },
      ];
    }),
  ];
}

function readSocketData(data: unknown) {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString(
      "utf8",
    );
  }
  return "";
}

function safe<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

function delay(ms: number) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}
