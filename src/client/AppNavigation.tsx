import { useRef } from "react";

export type AppTab =
  | "chat"
  | "terminal"
  | "file"
  | "settings"
  | "diff"
  | "validation"
  | "preview"
  | "workbench"
  | "evaluation"
  | "replay";

export type NavigationItem = { tab: AppTab; label: string };
export type NavigationGroup = { label: string; items: NavigationItem[] };

export const PRIMARY_DESTINATIONS = [
  { tab: "chat", label: "Chat" },
  { tab: "terminal", label: "Terminal" },
] as const satisfies readonly NavigationItem[];

const BASE_NAVIGATION_GROUPS: readonly NavigationGroup[] = [
  {
    label: "Workspace tools",
    items: [
      { tab: "diff", label: "Changes" },
      { tab: "validation", label: "Run checks" },
      { tab: "preview", label: "Preview" },
    ],
  },
  {
    label: "Advanced",
    items: [
      { tab: "workbench", label: "Workbench" },
      { tab: "evaluation", label: "Evaluation" },
      { tab: "replay", label: "Replay" },
    ],
  },
  {
    label: "Settings",
    items: [{ tab: "settings", label: "Settings" }],
  },
];

export function navigationGroups(hasFile: boolean): NavigationGroup[] {
  return BASE_NAVIGATION_GROUPS.map((group, index) => ({
    label: group.label,
    items:
      hasFile && index === 0
        ? [...group.items, { tab: "file", label: "Open file" }]
        : [...group.items],
  }));
}

export function statusLabel(running: boolean): "Ready" | "Working" {
  return running ? "Working" : "Ready";
}

export function AppNavigation({
  tab,
  running,
  sidebarHidden,
  hasFile,
  onTab,
  onToggleSidebar,
}: {
  tab: AppTab;
  running: boolean;
  sidebarHidden: boolean;
  hasFile: boolean;
  onTab: (tab: AppTab) => void;
  onToggleSidebar: () => void;
}) {
  const moreRef = useRef<HTMLDetailsElement>(null);
  const groups = navigationGroups(hasFile);
  const activeSecondary = groups
    .flatMap((group) => group.items)
    .find((item) => item.tab === tab);

  function closeMore(returnFocus = false) {
    moreRef.current?.removeAttribute("open");
    if (returnFocus)
      moreRef.current?.querySelector<HTMLElement>("summary")?.focus();
  }

  function selectTab(next: AppTab) {
    onTab(next);
    closeMore();
  }

  return (
    <header className="topbar">
      <div className="topbar-main">
        {sidebarHidden && (
          <button
            type="button"
            className="sidebar-toggle"
            onClick={onToggleSidebar}
          >
            History
          </button>
        )}
        <nav className="tabs" aria-label="Workspace views">
          {PRIMARY_DESTINATIONS.map((item) => (
            <button
              type="button"
              key={item.tab}
              aria-current={tab === item.tab ? "page" : undefined}
              className={tab === item.tab ? "active" : ""}
              onClick={() => onTab(item.tab)}
            >
              {item.label}
            </button>
          ))}
          <details
            ref={moreRef}
            className="more-tabs"
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              closeMore(true);
            }}
          >
            <summary className={activeSecondary ? "active" : ""}>
              More{activeSecondary ? ` · ${activeSecondary.label}` : ""}
            </summary>
            <div className="more-tabs-menu">
              {groups.map((group) => (
                <section className="more-tabs-group" key={group.label}>
                  <div className="more-tabs-heading">{group.label}</div>
                  {group.items.map((item) => (
                    <button
                      type="button"
                      key={item.tab}
                      aria-current={tab === item.tab ? "page" : undefined}
                      className={tab === item.tab ? "active" : ""}
                      onClick={() => selectTab(item.tab)}
                    >
                      {item.label}
                    </button>
                  ))}
                </section>
              ))}
            </div>
          </details>
        </nav>
      </div>
      <div className="statusline" aria-live="polite">
        <span
          className={`status-dot ${running ? "ok" : "muted"}`}
          aria-hidden="true"
        />
        <strong>{statusLabel(running)}</strong>
      </div>
    </header>
  );
}
