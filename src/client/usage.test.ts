import { describe, expect, it } from "vitest";
import { usageFromStatus } from "./usage";

describe("usageFromStatus", () => {
  it("normalizes missing usage without crashing", () => {
    expect(usageFromStatus(null)).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cost: 0,
      contextPercent: 0,
      toolCount: 0,
    });
  });

  it("reads token aliases and active tool count", () => {
    expect(
      usageFromStatus({
        tokens: { prompt: 3, completion: 4 },
        cost: 0.1,
        contextUsage: { percent: 12 },
        activeTools: ["bash"],
      }),
    ).toMatchObject({
      inputTokens: 3,
      outputTokens: 4,
      cost: 0.1,
      contextPercent: 12,
      toolCount: 1,
    });
  });
});
