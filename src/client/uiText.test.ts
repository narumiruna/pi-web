import { describe, expect, it } from "vitest";
import { nextStepFor, noticeTone, sessionTitle, toolRiskLabel } from "./uiText";

describe("ui text helpers", () => {
  it("marks rejected goal completion as actionable warning", () => {
    const message = "Goal completion rejected: no active goal.";

    expect(noticeTone(message)).toBe("warning");
    expect(nextStepFor(message)).toContain("active goal");
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
    ).toBe("New session");
  });

  it("uses conservative labels for risky tool names", () => {
    expect(toolRiskLabel("bash")).toBe("shell");
    expect(toolRiskLabel("edit_file")).toBe("file write");
    expect(toolRiskLabel("firecrawl_scrape")).toBe("network");
  });
});
