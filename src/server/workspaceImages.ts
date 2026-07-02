import { execFile as execFileCallback } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { extname, relative } from "node:path";
import { promisify } from "node:util";
import { imageMimeFromPath } from "./fileTypes.js";
import { resolveInside } from "./pathSafety.js";

const execFile = promisify(execFileCallback);
const SVG_CONVERT_TIMEOUT_MS = 10_000;
const SVG_CONVERT_MAX_BUFFER = 25 * 1024 * 1024;

export type WorkspaceImage = {
  path: string;
  size: number;
  mimeType: string;
  data: Buffer;
  converted: boolean;
};

export type SvgConverter = (file: string) => Promise<Buffer>;

export { imageMimeFromPath } from "./fileTypes.js";

export async function convertSvgWithRsvg(file: string): Promise<Buffer> {
  const { stdout } = (await execFile("rsvg-convert", [file], {
    encoding: "buffer",
    maxBuffer: SVG_CONVERT_MAX_BUFFER,
    timeout: SVG_CONVERT_TIMEOUT_MS,
  })) as { stdout: Buffer };
  return stdout;
}

export async function readWorkspaceImage(
  root: string,
  requested = ".",
  convertSvg: SvgConverter = convertSvgWithRsvg,
): Promise<WorkspaceImage> {
  const file = resolveInside(root, requested || ".");
  const info = await stat(file);
  if (!info.isFile()) throw new Error("Not a file");

  const ext = extname(file).toLowerCase();
  const mimeType = imageMimeFromPath(file);
  if (!mimeType) throw new Error("Unsupported image type");

  if (ext === ".svg") {
    return {
      path: relative(root, file),
      size: info.size,
      mimeType: "image/png",
      data: await convertSvg(file),
      converted: true,
    };
  }

  return {
    path: relative(root, file),
    size: info.size,
    mimeType,
    data: await readFile(file),
    converted: false,
  };
}
