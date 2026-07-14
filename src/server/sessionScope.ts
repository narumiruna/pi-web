import { resolve } from "node:path";

export type SessionCwd = { cwd?: unknown };

function normalizedCwd(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  return resolve(value);
}

export function isSessionInWorkspace(
  session: SessionCwd,
  workspace: string,
): boolean {
  const sessionCwd = normalizedCwd(session.cwd);
  const workspaceCwd = normalizedCwd(workspace);
  return Boolean(sessionCwd && workspaceCwd && sessionCwd === workspaceCwd);
}

export function filterSessionsForWorkspace<T extends SessionCwd>(
  sessions: T[],
  workspace: string,
): T[] {
  return sessions.filter((session) => isSessionInWorkspace(session, workspace));
}

export function requireWorkspaceCwd(
  requestedCwd: string | undefined,
  workspace: string,
): string {
  const normalizedWorkspace = resolve(workspace);
  if (!requestedCwd?.trim()) return normalizedWorkspace;
  if (resolve(requestedCwd) !== normalizedWorkspace)
    throw new Error("Session cwd must match the startup workspace");
  return normalizedWorkspace;
}
