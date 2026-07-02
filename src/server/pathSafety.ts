import { isAbsolute, relative, resolve } from "node:path";

export function resolveInside(root: string, requested = "."): string {
  const base = resolve(root);
  const target = resolve(base, requested || ".");
  const rel = relative(base, target);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return target;
  throw new Error("Path escapes workspace");
}
