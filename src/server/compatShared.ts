// biome-ignore-all lint: shared compat helpers accept third-party wire shapes.
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export async function runCommand(
  cmd: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
) {
  return new Promise<{ code: number | null; output: string }>((done) => {
    const child = spawn(cmd, args, { cwd, env: process.env });
    let output = "";
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on("data", (chunk) => (output += chunk.toString()));
    child.stderr.on("data", (chunk) => (output += chunk.toString()));
    child.on("close", (code) => {
      clearTimeout(timer);
      done({ code, output });
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      done({ code: 1, output: error.message });
    });
  });
}

export async function readJson(path: string, fallback: any) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

export async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function piWebDir() {
  return resolve(process.env.PI_WEB_DATA_DIR ?? join(homedir(), ".pi-web"));
}

export function projectsPath() {
  return resolve(
    process.env.PI_WEB_PROJECTS_FILE ?? join(piWebDir(), "projects.json"),
  );
}

export function machinesPath() {
  return resolve(
    process.env.PI_WEB_MACHINES_FILE ?? join(piWebDir(), "machines.json"),
  );
}

export function configPath() {
  return resolve(
    process.env.PI_WEB_CONFIG ??
      join(
        process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
        "pi-web",
        "config.json",
      ),
  );
}

export function modelsConfigPath() {
  return join(getAgentDir(), "models.json");
}

export function expandHome(path: string) {
  return path === "~" || path.startsWith("~/")
    ? join(homedir(), path.slice(2))
    : path;
}

export function isText(path: string) {
  return ![
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".pdf",
    ".zip",
    ".gz",
    ".tar",
    ".wasm",
    ".mp3",
    ".wav",
    ".ogg",
  ].includes(extname(path).toLowerCase());
}

export function mimeFromPath(path: string) {
  const ext = extname(path).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".wav") return "audio/wav";
  return "text/plain; charset=utf-8";
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function escapeHtml(value: string) {
  return value.replace(
    /[&<>"]/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]!,
  );
}
