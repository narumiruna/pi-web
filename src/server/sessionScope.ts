import { resolve } from "node:path";

export type SessionCwd = { cwd?: unknown };

function sessionCwd(value: unknown): unknown {
  return value && typeof value === "object"
    ? (value as SessionCwd).cwd
    : undefined;
}

function normalizedCwd(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  return resolve(value);
}

export function isSessionInWorkspace(
  session: unknown,
  workspace: string,
): boolean {
  const normalizedSessionCwd = normalizedCwd(sessionCwd(session));
  const workspaceCwd = normalizedCwd(workspace);
  return Boolean(
    normalizedSessionCwd &&
      workspaceCwd &&
      normalizedSessionCwd === workspaceCwd,
  );
}

export function filterSessionsForWorkspace<T>(
  sessions: T[],
  workspace: string,
): T[] {
  return sessions.filter((session) => isSessionInWorkspace(session, workspace));
}

export function requireWorkspaceCwd(
  requestedCwd: unknown,
  workspace: string,
): string {
  const normalizedWorkspace = resolve(workspace);
  if (requestedCwd === undefined) return normalizedWorkspace;
  if (typeof requestedCwd !== "string")
    throw new Error("Session cwd must be a string");
  if (!requestedCwd.trim()) return normalizedWorkspace;
  if (resolve(requestedCwd) !== normalizedWorkspace)
    throw new Error("Session cwd must match the startup workspace");
  return normalizedWorkspace;
}
