// biome-ignore-all lint: shared compat helpers accept third-party wire shapes.
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { isTextPath, mimeFromPath } from "./fileTypes.js";

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

export function expandHome(path: string) {
  return path === "~" || path.startsWith("~/")
    ? join(homedir(), path.slice(2))
    : path;
}

export { mimeFromPath };
export const isText = isTextPath;

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
