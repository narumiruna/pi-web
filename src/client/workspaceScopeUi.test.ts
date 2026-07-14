import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Sidebar } from "./Sidebar";
import { WorkbenchPane } from "./WorkbenchPane";

const noop = vi.fn();

describe("fixed workspace UI", () => {
  it("renders the launch workspace path as read-only without worktree creation", () => {
    const html = renderToStaticMarkup(
      createElement(Sidebar, {
        cwd: "/workspace/project",
        sessions: [],
        selected: null,
        deletingSessionId: "",
        files: [],
        filePath: "",
        activeFilePath: "",
        onNewSession: noop,
        creatingSession: false,
        onHide: noop,
        permissionProfile: "ask",
        onPermissionProfile: noop,
        onSelectSession: noop,
        onSelectSearchResult: noop,
        onDeleteSession: noop,
        onFilePath: noop,
        onOpenFile: noop,
      }),
    );

    expect(html).toContain(
      '<input class="input" readOnly="" value="/workspace/project"/>',
    );
    expect(html).not.toContain("Create parallel worktree");
  });

  it("does not offer issue-to-worktree session creation", () => {
    const html = renderToStaticMarkup(
      createElement(WorkbenchPane, {
        cwd: "/workspace/project",
        sessions: [],
        onNotice: noop,
        onOpenDiff: noop,
        onOpenValidation: noop,
      }),
    );

    expect(html).not.toContain("Worktree session");
  });
});
