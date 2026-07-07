// biome-ignore-all lint: terminal websocket wire data is intentionally small here.
import { chmodSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import * as pty from "node-pty";

type Json = Record<string, unknown>;

const nodeRequire = createRequire(import.meta.url);
const PATH_ENV = process.platform === "win32" ? "Path" : "PATH";
const PATH_SEPARATOR = process.platform === "win32" ? ";" : ":";
const LOCAL_BIN_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "node_modules",
  ".bin",
);

function terminalEnv() {
  const currentPath = process.env[PATH_ENV] ?? process.env.PATH ?? "";
  return {
    ...process.env,
    [PATH_ENV]: [currentPath, LOCAL_BIN_DIR]
      .filter(Boolean)
      .join(PATH_SEPARATOR),
    TERM: "xterm-256color",
  };
}

function ensurePtyHelperExecutable() {
  if (process.platform === "win32") return;
  const nodePtyRoot = resolve(dirname(nodeRequire.resolve("node-pty")), "..");
  for (const helper of [
    join(nodePtyRoot, "build", "Release", "spawn-helper"),
    join(
      nodePtyRoot,
      "prebuilds",
      `${process.platform}-${process.arch}`,
      "spawn-helper",
    ),
  ]) {
    try {
      if (existsSync(helper)) chmodSync(helper, 0o755);
    } catch {
      // node-pty will report the spawn failure if chmod is not allowed.
    }
  }
}

function jsonError(error: unknown): { error: string } {
  return { error: error instanceof Error ? error.message : String(error) };
}

export function registerTerminalRoutes(
  app: FastifyInstance,
  defaultCwd: string,
) {
  app.get<{ Querystring: { cwd?: string } }>(
    "/api/terminal",
    { websocket: true },
    (socket: any, request) => {
      const cwd = resolve(request.query.cwd || defaultCwd);
      const shell = process.env.PI_WEB_SHELL || "/bin/sh";
      const send = (event: Json) => {
        if (socket.readyState === 1) socket.send(JSON.stringify(event));
      };
      let child: pty.IPty;
      try {
        ensurePtyHelperExecutable();
        child = pty.spawn(shell, [], {
          cols: 80,
          rows: 24,
          cwd,
          env: terminalEnv(),
          name: "xterm-256color",
        });
      } catch (error) {
        send({
          type: "data",
          data: `[terminal failed: ${jsonError(error).error}]\r\n`,
        });
        send({ type: "exit", code: 1 });
        socket.close();
        return;
      }
      child.onData((data) => send({ type: "data", data }));
      child.onExit(({ exitCode }) => send({ type: "exit", code: exitCode }));
      socket.on("message", (raw: Buffer | string) => {
        const text = raw.toString();
        try {
          const msg = JSON.parse(text);
          if (msg.type === "input" && typeof msg.data === "string")
            child.write(msg.data);
          if (msg.type === "resize") {
            const cols = Number(msg.cols);
            const rows = Number(msg.rows);
            if (Number.isFinite(cols) && Number.isFinite(rows))
              child.resize(
                Math.min(500, Math.max(2, Math.floor(cols))),
                Math.min(200, Math.max(1, Math.floor(rows))),
              );
          }
          if (msg.type === "close") child.kill();
        } catch {
          child.write(text);
        }
      });
      socket.on("close", () => child.kill());
    },
  );
}
