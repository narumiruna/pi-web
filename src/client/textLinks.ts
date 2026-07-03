export type TextLinkPart =
  | { type: "text"; text: string }
  | { type: "link"; text: string; href: string };

const URL_PATTERN = /https?:\/\/[^\s<>"']+/g;
const SIMPLE_TRAILING_PUNCTUATION = /[.,;:!?]+$/;
const OPENING_BRACKET: Record<string, string> = {
  ")": "(",
  "]": "[",
  "}": "{",
};

function count(text: string, character: string): number {
  return text.split(character).length - 1;
}

function trimUrl(rawUrl: string): string {
  let url = rawUrl.replace(SIMPLE_TRAILING_PUNCTUATION, "");

  for (;;) {
    const last = url[url.length - 1];
    const opening = OPENING_BRACKET[last];
    if (!opening || count(url, last) <= count(url, opening)) return url;
    url = url.slice(0, -1).replace(SIMPLE_TRAILING_PUNCTUATION, "");
  }
}

export function linkifyText(text: string): TextLinkPart[] {
  const parts: TextLinkPart[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(URL_PATTERN)) {
    const rawUrl = match[0];
    const start = match.index ?? 0;
    const url = trimUrl(rawUrl);
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
