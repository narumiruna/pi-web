import { extname } from "node:path";

const MIME_BY_EXT = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".svg", "image/svg+xml"],
  [".pdf", "application/pdf"],
  [".mp3", "audio/mpeg"],
  [".wav", "audio/wav"],
]);

const BINARY_EXTENSIONS = new Set([
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
]);

export function mimeFromPath(path: string): string {
  return (
    MIME_BY_EXT.get(extname(path).toLowerCase()) ?? "text/plain; charset=utf-8"
  );
}

export function imageMimeFromPath(path: string): string | undefined {
  const mimeType = MIME_BY_EXT.get(extname(path).toLowerCase());
  return mimeType?.startsWith("image/") ? mimeType : undefined;
}

export function isTextPath(path: string): boolean {
  return !BINARY_EXTENSIONS.has(extname(path).toLowerCase());
}
