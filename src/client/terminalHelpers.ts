export function trimTerminalBuffer(
  lines: string[],
  maxLines = 5000,
  maxChars = 200_000,
): string[] {
  let next = lines.slice(-maxLines);
  while (next.join("\n").length > maxChars)
    next = next.slice(Math.max(1, Math.floor(next.length / 10)));
  return next;
}

export function hasSecretLikeText(text: string): boolean {
  return /(api[_-]?key|token|password|secret)\s*[:=]/i.test(text);
}

export type CommandSnippet = { name: string; command: string };
export function parseSnippets(value: string | null): CommandSnippet[] {
  try {
    const parsed = JSON.parse(value ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter(
          (item) =>
            typeof item?.name === "string" && typeof item?.command === "string",
        )
      : [];
  } catch {
    return [];
  }
}
