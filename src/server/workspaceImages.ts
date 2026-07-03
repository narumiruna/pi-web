import { readFile, stat } from "node:fs/promises";
import { relative } from "node:path";
import { imageMimeFromPath } from "./fileTypes.js";
import { resolveInside } from "./pathSafety.js";

const MAX_SVG_BYTES = 25 * 1024 * 1024;

export type WorkspaceImage = {
  path: string;
  size: number;
  mimeType: string;
  data: Buffer;
  converted: boolean;
};

export { imageMimeFromPath } from "./fileTypes.js";

export async function readWorkspaceImage(
  root: string,
  requested = ".",
): Promise<WorkspaceImage> {
  const file = resolveInside(root, requested || ".");
  const info = await stat(file);
  if (!info.isFile()) throw new Error("Not a file");

  const mimeType = imageMimeFromPath(file);
  if (!mimeType) throw new Error("Unsupported image type");
  if (mimeType === "image/svg+xml" && info.size > MAX_SVG_BYTES)
    throw new Error("SVG image is too large");

  return {
    path: relative(root, file),
    size: info.size,
    mimeType,
    data: await readFile(file),
    converted: false,
  };
}
