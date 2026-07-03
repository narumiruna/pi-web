export type TextLinkPart =
  | { type: "text"; text: string }
  | { type: "link"; text: string; href: string };

const URL_PATTERN = /https?:\/\/[^\s<>"']+/g;
const TRAILING_PUNCTUATION = /[\])}.,;:!?]+$/;

export function linkifyText(text: string): TextLinkPart[] {
  const parts: TextLinkPart[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(URL_PATTERN)) {
    const rawUrl = match[0];
    const start = match.index ?? 0;
    const url = rawUrl.replace(TRAILING_PUNCTUATION, "");
    const end = start + url.length;

    if (start > lastIndex) {
      parts.push({ type: "text", text: text.slice(lastIndex, start) });
    }
    parts.push({ type: "link", text: url, href: url });
    lastIndex = end;
  }

  if (lastIndex < text.length) {
    parts.push({ type: "text", text: text.slice(lastIndex) });
  }

  return parts.length ? parts : [{ type: "text", text }];
}
