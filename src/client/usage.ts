export type UsageSnapshot = {
  inputTokens: number;
  outputTokens: number;
  cost: number;
  contextPercent: number;
  toolCount: number;
};

type UsageStatus =
  | {
      tokens?: {
        input?: number;
        prompt?: number;
        output?: number;
        completion?: number;
      };
      cost?: number;
      contextUsage?: { percentage?: number; percent?: number };
      activeTools?: unknown[];
    }
  | null
  | undefined;

export function usageFromStatus(status: UsageStatus): UsageSnapshot {
  const tokens = status?.tokens ?? {};
  return {
    inputTokens: Number(tokens.input ?? tokens.prompt ?? 0),
    outputTokens: Number(tokens.output ?? tokens.completion ?? 0),
    cost: Number(status?.cost ?? 0),
    contextPercent: Number(
      status?.contextUsage?.percentage ?? status?.contextUsage?.percent ?? 0,
    ),
    toolCount: Array.isArray(status?.activeTools)
      ? status.activeTools.length
      : 0,
  };
}
