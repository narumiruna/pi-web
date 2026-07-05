export type ShortcutAction =
  | "newSession"
  | "focusPrompt"
  | "openDiff"
  | "openValidation"
  | "toggleHelp";

export const shortcutMap: Record<string, ShortcutAction> = {
  "mod+n": "newSession",
  "mod+k": "focusPrompt",
  "mod+d": "openDiff",
  "mod+shift+t": "openValidation",
  "?": "toggleHelp",
};

export function shortcutKey(
  event: Pick<
    KeyboardEvent,
    "key" | "metaKey" | "ctrlKey" | "shiftKey" | "target"
  >,
): string | undefined {
  const target = event.target as HTMLElement | null;
  const tag = target?.tagName?.toLowerCase();
  if (tag === "input" || tag === "textarea" || target?.isContentEditable)
    return;
  const parts = [];
  if (event.metaKey || event.ctrlKey) parts.push("mod");
  if (event.shiftKey) parts.push("shift");
  parts.push(
    event.key.length === 1 ? event.key.toLowerCase() : event.key.toLowerCase(),
  );
  return parts.join("+");
}

export function shortcutAction(
  event: KeyboardEvent,
): ShortcutAction | undefined {
  const key = shortcutKey(event);
  return key ? shortcutMap[key] : undefined;
}
