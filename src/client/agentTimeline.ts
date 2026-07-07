export type AgentTimelineItem = {
  phase: "Plan" | "Act" | "Verify";
  title: string;
  detail: string;
  state: "pending" | "running" | "done" | "failed";
};

type MessagePart = {
  text?: string;
  thinking?: string;
  name?: string;
  toolName?: string;
};
export type TimelineMessage = {
  role?: string;
  content?: string | MessagePart[];
  toolName?: string;
  isError?: boolean;
};

function textFromContent(content: TimelineMessage["content"]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map(
      (part) => part.text ?? part.thinking ?? part.name ?? part.toolName ?? "",
    )
    .join("\n");
}

export type ValidationSummary = {
  command: string;
  ok: boolean;
  code: number | null;
  finishedAt?: string;
};

export function buildAgentTimeline(
  messages: TimelineMessage[],
  running = false,
  validation?: ValidationSummary | null,
): AgentTimelineItem[] {
  const user = messages.find((message) => message.role === "user");
  const plan = messages.find((message) =>
    /\b(plan|todo|checklist)\b/i.test(textFromContent(message.content)),
  );
  const tools = messages.filter(
    (message) => message.role === "toolResult" || message.toolName,
  );
  const failedTool = tools.find((message) => message.isError);
  const verify = messages.find((message) =>
    /\b(test|lint|typecheck|build|verify|pass|fail)\b/i.test(
      textFromContent(message.content),
    ),
  );
  return [
    {
      phase: "Plan",
      title: plan ? "Plan captured" : "Waiting for plan",
      detail: (
        textFromContent(plan?.content) ||
        textFromContent(user?.content) ||
        "No prompt yet"
      ).slice(0, 240),
      state: plan || user ? "done" : "pending",
    },
    {
      phase: "Act",
      title: tools.length
        ? `${tools.length} tool action${tools.length === 1 ? "" : "s"}`
        : "No tool action yet",
      detail:
        tools
          .map((message) => message.toolName)
          .filter(Boolean)
          .join(", ") || "Tool calls appear here.",
      state: failedTool
        ? "failed"
        : tools.length
          ? "done"
          : running
            ? "running"
            : "pending",
    },
    validation
      ? {
          phase: "Verify",
          title: `Validation ${validation.ok ? "passed" : "failed"}`,
          detail: `${validation.command} exited ${validation.code}`,
          state: validation.ok ? "done" : "failed",
        }
      : {
          phase: "Verify",
          title: verify ? "Verification mentioned" : "Verification pending",
          detail: verify
            ? textFromContent(verify.content).slice(0, 240)
            : "Run validation before merging.",
          state: verify
            ? /(fail|error)/i.test(textFromContent(verify.content))
              ? "failed"
              : "done"
            : "pending",
        },
  ];
}
