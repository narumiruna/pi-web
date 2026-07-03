// biome-ignore-all lint: shared compat helpers accept third-party wire shapes.
import { spawn } from "node:child_process";

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

export function escapeHtml(value: string) {
  return value.replace(
    /[&<>"]/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]!,
  );
}
