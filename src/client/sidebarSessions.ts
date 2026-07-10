import type { SessionInfo } from "./types";

export const RECENT_CHAT_LIMIT = 12;

export function visibleSidebarSessions(
  sessions: SessionInfo[],
  filter: string,
  showAll: boolean,
  selectedId?: string,
): SessionInfo[] {
  const query = filter.trim().toLowerCase();
  const matching = query
    ? sessions.filter((session) =>
        [session.name, session.firstMessage, session.cwd]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(query)),
      )
    : sessions;

  if (query || showAll) return matching;

  const recent = matching.slice(0, RECENT_CHAT_LIMIT);
  if (!selectedId || recent.some((session) => session.id === selectedId))
    return recent;
  const selected = matching.find((session) => session.id === selectedId);
  return selected
    ? [selected, ...recent.slice(0, RECENT_CHAT_LIMIT - 1)]
    : recent;
}
