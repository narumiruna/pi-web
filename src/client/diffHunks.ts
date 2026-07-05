export type DiffHunk = {
  path: string;
  header: string;
  patch: string;
};

// Split a unified git diff into per-hunk patches that `git apply -R` accepts.
export function splitPatchIntoHunks(patch: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  const files = patch.split(/^(?=diff --git )/m).filter(Boolean);
  for (const file of files) {
    const lines = file.split("\n");
    const firstHunk = lines.findIndex((line) => line.startsWith("@@"));
    if (firstHunk === -1) continue;
    const fileHeader = lines.slice(0, firstHunk).join("\n");
    const path = /^diff --git a\/.* b\/(.*)$/.exec(lines[0])?.[1] ?? "unknown";
    let current: string[] = [];
    const flush = () => {
      if (current.length === 0) return;
      hunks.push({
        path,
        header: current[0],
        patch: `${fileHeader}\n${current.join("\n")}\n`,
      });
      current = [];
    };
    for (const line of lines.slice(firstHunk)) {
      if (line.startsWith("@@")) flush();
      if (line.startsWith("@@") || current.length > 0) current.push(line);
    }
    flush();
  }
  return hunks;
}
