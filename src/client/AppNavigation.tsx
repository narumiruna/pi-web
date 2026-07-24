import {
  ActivityLogIcon,
  ChatBubbleIcon,
  CheckCircledIcon,
  ChevronDownIcon,
  CodeIcon,
  EyeOpenIcon,
  FileTextIcon,
  GearIcon,
  HamburgerMenuIcon,
  MixerHorizontalIcon,
  ReaderIcon,
  ReloadIcon,
} from "@radix-ui/react-icons";
import { Badge, DropdownMenu, Tabs } from "@radix-ui/themes";
import type { ReactNode } from "react";
import { Button } from "./ui";

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

export const SECONDARY_NAVIGATION_LABEL = "Tools";

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

function NavigationIcon({ tab }: { tab: AppTab }): ReactNode {
  if (tab === "chat") return <ChatBubbleIcon />;
  if (tab === "terminal") return <CodeIcon />;
  if (tab === "diff") return <ReaderIcon />;
  if (tab === "validation") return <CheckCircledIcon />;
  if (tab === "preview") return <EyeOpenIcon />;
  if (tab === "file") return <FileTextIcon />;
  if (tab === "workbench") return <MixerHorizontalIcon />;
  if (tab === "evaluation") return <ActivityLogIcon />;
  if (tab === "replay") return <ReloadIcon />;
  return <GearIcon />;
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
  const groups = navigationGroups(hasFile);
  const activeSecondary = groups
    .flatMap((group) => group.items)
    .find((item) => item.tab === tab);

  return (
    <header className="topbar">
      <div className="topbar-main">
        {sidebarHidden && (
          <Button
            type="button"
            className="sidebar-toggle"
            aria-controls="history-sidebar"
            aria-expanded={!sidebarHidden}
            onClick={onToggleSidebar}
          >
            <HamburgerMenuIcon />
            History
          </Button>
        )}
        <nav className="tabs" aria-label="Workspace views">
          <Tabs.Root
            value={
              PRIMARY_DESTINATIONS.some((item) => item.tab === tab) ? tab : ""
            }
            onValueChange={(value) => onTab(value as AppTab)}
          >
            <Tabs.List>
              {PRIMARY_DESTINATIONS.map((item) => (
                <Tabs.Trigger key={item.tab} value={item.tab}>
                  <NavigationIcon tab={item.tab} />
                  {item.label}
                </Tabs.Trigger>
              ))}
            </Tabs.List>
          </Tabs.Root>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              <Button
                type="button"
                className={activeSecondary ? "active" : ""}
                aria-label="Open workspace tools"
              >
                {activeSecondary ? (
                  <NavigationIcon tab={activeSecondary.tab} />
                ) : (
                  <MixerHorizontalIcon />
                )}
                {activeSecondary?.label ?? SECONDARY_NAVIGATION_LABEL}
                <ChevronDownIcon className="disclosure-chevron" />
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content className="more-tabs-menu" align="start">
              {groups.map((group, groupIndex) => (
                <div key={group.label}>
                  {groupIndex > 0 && <DropdownMenu.Separator />}
                  <DropdownMenu.Label>{group.label}</DropdownMenu.Label>
                  {group.items.map((item) => (
                    <DropdownMenu.Item
                      key={item.tab}
                      className={tab === item.tab ? "active" : ""}
                      onSelect={() => onTab(item.tab)}
                    >
                      <NavigationIcon tab={item.tab} />
                      {item.label}
                    </DropdownMenu.Item>
                  ))}
                </div>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        </nav>
      </div>
      <Badge
        className="statusline"
        color={running ? "blue" : "gray"}
        variant="surface"
        role="status"
        aria-label={`Agent status: ${statusLabel(running)}`}
      >
        <span
          className={`status-dot ${running ? "ok" : "muted"}`}
          aria-hidden="true"
        />
        {statusLabel(running)}
      </Badge>
    </header>
  );
}
