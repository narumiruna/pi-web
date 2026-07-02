export type WorkspaceImagePart =
  | { type: "text"; text: string }
  | { type: "workspaceImage"; alt: string; path: string };

const WORKSPACE_IMAGE_RE = /!\[([^\]\n]*)\]\(workspace:\/\/([^)\s]+)\)/g;

function decodePath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

export function parseWorkspaceImageMarkdown(
  text: string,
): WorkspaceImagePart[] {
  const parts: WorkspaceImagePart[] = [];
  let index = 0;
  for (const match of text.matchAll(WORKSPACE_IMAGE_RE)) {
    if (match.index === undefined) continue;
    if (match.index > index)
      parts.push({ type: "text", text: text.slice(index, match.index) });
    parts.push({
      type: "workspaceImage",
      alt: match[1] || "workspace image",
      path: decodePath(match[2]),
    });
    index = match.index + match[0].length;
  }
  if (index < text.length)
    parts.push({ type: "text", text: text.slice(index) });
  return parts.length ? parts : [{ type: "text", text }];
}

export function workspaceImageUrl(cwd: string, path: string): string {
  return `/api/files/image?${new URLSearchParams({ cwd, path })}`;
}
