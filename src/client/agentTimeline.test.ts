import { describe, expect, it } from "vitest";
import { buildAgentTimeline } from "./agentTimeline";

describe("agent timeline", () => {
  it("maps prompt, tool results, and verification messages to Plan/Act/Verify", () => {
    const timeline = buildAgentTimeline([
      { role: "user", content: "make a plan" },
      { role: "toolResult", toolName: "bash", content: "ok" },
      { role: "assistant", content: "npm test passed" },
    ]);

    expect(timeline.map((item) => item.phase)).toEqual([
      "Plan",
      "Act",
      "Verify",
    ]);
    expect(timeline[1]).toMatchObject({
      state: "done",
      title: "1 tool action",
    });
    expect(timeline[2].state).toBe("done");
  });

  it("marks failed tool action", () => {
    const timeline = buildAgentTimeline([
      { role: "toolResult", toolName: "bash", isError: true, content: "boom" },
    ]);
    expect(timeline[1].state).toBe("failed");
  });

  it("prefers the latest validation result for the Verify phase", () => {
    const timeline = buildAgentTimeline([], false, {
      command: "npm test",
      ok: false,
      code: 1,
    });
    expect(timeline[2]).toMatchObject({
      phase: "Verify",
      title: "Validation failed",
      detail: "npm test exited 1",
      state: "failed",
    });
  });
});
