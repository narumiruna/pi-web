import { describe, expect, it } from "vitest";
import {
  navigationGroups,
  PRIMARY_DESTINATIONS,
  SECONDARY_NAVIGATION_LABEL,
  statusLabel,
} from "./AppNavigation";

describe("simplified application navigation", () => {
  it("keeps only chat, terminal, and more at the top level", () => {
    expect(PRIMARY_DESTINATIONS).toEqual([
      { tab: "chat", label: "Chat" },
      { tab: "terminal", label: "Terminal" },
    ]);
  });

  it("labels secondary destinations as workspace tools", () => {
    expect(SECONDARY_NAVIGATION_LABEL).toBe("Tools");
  });

  it("groups every secondary destination by user intent", () => {
    expect(navigationGroups(false)).toEqual([
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
    ]);
  });

  it("adds an open file to workspace tools without another top-level tab", () => {
    const groups = navigationGroups(true);

    expect(groups[0]?.items.at(-1)).toEqual({
      tab: "file",
      label: "Open file",
    });
    expect(groups.flatMap((group) => group.items)).toHaveLength(8);
  });

  it("uses a single calm run-state label", () => {
    expect(statusLabel(false)).toBe("Ready");
    expect(statusLabel(true)).toBe("Working");
  });
});
