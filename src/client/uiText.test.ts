import { describe, expect, it } from "vitest";
import {
  nextStepFor,
  noticeTone,
  sessionTitle,
  toolResultDisclosure,
  toolRiskLabel,
} from "./uiText";

describe("ui text helpers", () => {
  it("marks rejected goal completion as actionable warning", () => {
    const message = "Goal completion rejected: no active goal.";

    expect(noticeTone(message)).toBe("warning");
    expect(nextStepFor(message)).toContain("active goal");
  });

  it("marks gateway, availability, and connection failures as danger", () => {
    expect(noticeTone("Bad Gateway")).toBe("danger");
    expect(noticeTone("Git unavailable")).toBe("danger");
    expect(noticeTone("Event stream disconnected")).toBe("danger");
  });

  it("names empty sessions without saying no session is selected", () => {
    expect(
      sessionTitle({
        id: "1",
        cwd: "/workspace",
        created: "2026-07-03T00:00:00Z",
        modified: "2026-07-03T00:00:00Z",
        messageCount: 0,
        firstMessage: "No session selected",
      }),
    ).toBe("New chat");
  });

  it("keeps routine tool output collapsed but surfaces errors", () => {
    expect(toolResultDisclosure({ isError: false, text: "done" })).toEqual({
      open: false,
      label: "Tool result",
    });
    expect(toolResultDisclosure({ isError: true, text: "failed" })).toEqual({
      open: true,
      label: "Tool error",
    });
  });

  it("uses conservative labels for risky tool names", () => {
    expect(toolRiskLabel("bash")).toBe("shell");
    expect(toolRiskLabel("edit_file")).toBe("file write");
    expect(toolRiskLabel("firecrawl_scrape")).toBe("network");
  });
});
