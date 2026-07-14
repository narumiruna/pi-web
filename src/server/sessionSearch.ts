import { SessionManager } from "@earendil-works/pi-coding-agent";

export type SearchableSession = {
  id: string;
  path: string;
  modified: string | Date;
};

export type SessionSearchResult = {
  sessionId: string;
  messageIndex: number;
  role?: string;
  excerpt: string;
  timestamp: string;
};

type SessionReader = { getEntries: () => unknown[] };
type OpenSession = (path: string) => SessionReader;
type ListSessions = () => Promise<SearchableSession[]>;

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue | undefined {
  return value && typeof value === "object"
    ? (value as RecordValue)
    : undefined;
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((value) => {
      const part = record(value);
      if (!part) return "";
      if (typeof part.text === "string") return part.text;
      if (typeof part.thinking === "string") return part.thinking;
      return typeof part.type === "string" ? `[${part.type}]` : "";
    })
    .join("\n");
}

export function searchSessionEntries(
  sessionId: string,
  entries: unknown[],
  query: string,
  fallbackTimestamp = "",
): SessionSearchResult[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const results: SessionSearchResult[] = [];
  entries.forEach((value, index) => {
    const entry = record(value);
    const message = record(entry?.message);
    const text = textFromContent(message?.content);
    if (!text.toLowerCase().includes(q)) return;
    results.push({
      sessionId,
      messageIndex: index,
      role: typeof message?.role === "string" ? message.role : undefined,
      excerpt: text.slice(0, 240),
      timestamp:
        typeof entry?.timestamp === "string"
          ? entry.timestamp
          : fallbackTimestamp,
    });
  });
  return results;
}

export async function searchScopedSessions(
  query: string,
  listSessions: ListSessions,
): Promise<SessionSearchResult[]> {
  if (!query.trim()) return [];
  return searchSessions(query, await listSessions());
}

export async function searchSessions(
  query: string,
  sessions: SearchableSession[],
  openSession: OpenSession = (path) => SessionManager.open(path),
): Promise<SessionSearchResult[]> {
  if (!query.trim()) return [];
  const results: SessionSearchResult[] = [];
  for (const session of sessions) {
    try {
      const manager = openSession(session.path);
      const modified =
        session.modified instanceof Date
          ? session.modified.toISOString()
          : session.modified;
      results.push(
        ...searchSessionEntries(
          session.id,
          manager.getEntries(),
          query,
          modified,
        ),
      );
    } catch {}
  }
  return results.slice(0, 50);
}
