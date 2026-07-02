import type { SessionInfo } from "./types";

export type NoticeTone = "warning" | "danger" | "ok" | "info";

export function noticeTone(message: string): NoticeTone {
  const text = message.toLowerCase();
  if (text.includes("rejected") || text.includes("warning")) return "warning";
  if (text.includes("error") || text.includes("failed")) return "danger";
  if (
    text.includes("saved") ||
    text.includes("updated") ||
    text.includes("copied") ||
    text.includes("deleted") ||
    text.includes("complete")
  )
    return "ok";
  return "info";
}

export function nextStepFor(message: string): string | undefined {
  const text = message.toLowerCase();
  if (
    text.includes("goal completion rejected") &&
    text.includes("no active goal")
  )
    return "Next: create or select an active goal before marking completion.";
  return undefined;
}

export function toolRiskLabel(toolName: string): string | undefined {
  const name = toolName.toLowerCase();
  if (["bash", "shell", "exec", "terminal"].some((part) => name.includes(part)))
    return "shell";
  if (["write", "edit", "delete", "patch"].some((part) => name.includes(part)))
    return "file write";
  if (
    name.startsWith("firecrawl_") ||
    ["fetch", "http", "web", "network", "navigate"].some((part) =>
      name.includes(part),
    )
  )
    return "network";
  return undefined;
}

export function sessionTitle(session: SessionInfo): string {
  if (session.name) return session.name;
  if (!session.firstMessage || session.firstMessage === "No session selected")
    return session.messageCount === 0 ? "New session" : "Untitled";
  return session.firstMessage;
}

export function scopeLabel(scope?: string): string {
  if (!scope) return "Session";
  return `${scope.slice(0, 1).toUpperCase()}${scope.slice(1)}`;
}
