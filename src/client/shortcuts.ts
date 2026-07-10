export type ShortcutAction =
  | "newSession"
  | "focusPrompt"
  | "openChat"
  | "openTerminal"
  | "openDiff"
  | "openValidation"
  | "abortAgent"
  | "toggleSidebar"
  | "toggleHelp";

export const shortcutMap: Record<string, ShortcutAction> = {
  "mod+n": "newSession",
  "mod+k": "focusPrompt",
  "mod+1": "openChat",
  "mod+2": "openTerminal",
  "mod+d": "openDiff",
  "mod+shift+t": "openValidation",
  "mod+.": "abortAgent",
  "mod+b": "toggleSidebar",
  "?": "toggleHelp",
};

export const shortcutHelp: Array<[string, string]> = [
  ["Ctrl/⌘ N", "New chat"],
  ["Ctrl/⌘ K", "Focus prompt"],
  ["Ctrl/⌘ 1", "Open chat tab"],
  ["Ctrl/⌘ 2", "Open terminal tab"],
  ["Ctrl/⌘ D", "Open changes"],
  ["Ctrl/⌘ Shift T", "Run checks"],
  ["Ctrl/⌘ .", "Abort running agent"],
  ["Ctrl/⌘ B", "Toggle history"],
  ["Ctrl/⌘ Enter", "Send prompt (in composer)"],
  ["Ctrl/⌘ Shift L", "Send recent terminal output to chat (in terminal)"],
  ["?", "Toggle this help"],
];

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
