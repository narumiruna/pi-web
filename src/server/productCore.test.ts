import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  type CommandResult,
  createCheckpoint,
  createWorktree,
  diagnostics,
  git,
  gitDiff,
  importIssue,
  lintInstructionContent,
  listBookmarks,
  listCheckpoints,
  listTasks,
  parseGoldenTask,
  parseIssueReference,
  permissionSettings,
  prCreateArgs,
  readMcpConfig,
  redactSecrets,
  removeWorktree,
  restoreMcpConfig,
  revertGitChange,
  reviewEvaluation,
  rewindCheckpoint,
  runGoldenTask,
  runValidation,
  saveBookmark,
  saveInstructionFile,
  saveMcpServer,
  saveTask,
  searchSessionEntries,
  toolsForPermissionProfile,
  validationCommand,
} from "./productCore.js";

async function tempDir(prefix: string) {
  return mkdtemp(join(tmpdir(), prefix));
}

async function repo() {
  const dir = await tempDir("pi-web-core-");
  await git(dir, ["init"]);
  await git(dir, ["config", "user.email", "test@example.com"]);
  await git(dir, ["config", "user.name", "Test"]);
  await writeFile(join(dir, "file.txt"), "one\n");
  await git(dir, ["add", "."]);
  await git(dir, ["commit", "-m", "init"]);
  return dir;
}

describe("product core", () => {
  beforeEach(async () => {
    process.env.PI_WEB_DATA_DIR = await tempDir("pi-web-data-");
  });

  it("reads git diff and reverts a file", async () => {
    const dir = await repo();
    await writeFile(join(dir, "file.txt"), "two\n");

    const diff = await gitDiff(dir);
    expect(diff.files[0].path).toBe("file.txt");

    await revertGitChange(dir, { path: "file.txt" });
    expect(await readFile(join(dir, "file.txt"), "utf8")).toBe("one\n");
  });

  it("creates and rewinds tracked and untracked checkpoint state", async () => {
    const dir = await repo();
    await writeFile(join(dir, "file.txt"), "before\n");
    await writeFile(join(dir, "note.txt"), "keep\n");
    const checkpoint = await createCheckpoint(dir, "s1");

    await writeFile(join(dir, "file.txt"), "after\n");
    await writeFile(join(dir, "new.txt"), "delete\n");
    const blocked = await rewindCheckpoint(checkpoint.id);
    expect(blocked).toMatchObject({ requiresConfirmation: true });

    await rewindCheckpoint(checkpoint.id, { confirmDelete: true });
    expect(await readFile(join(dir, "file.txt"), "utf8")).toBe("before\n");
    expect(await readFile(join(dir, "note.txt"), "utf8")).toBe("keep\n");
  });

  it("refuses to remove dirty worktrees without force", async () => {
    const dir = await repo();
    const worktree = await createWorktree(dir, "dirty");
    await writeFile(join(worktree.cwd, "file.txt"), "dirty\n");

    expect(await removeWorktree(dir, worktree.cwd)).toMatchObject({
      dirty: true,
      removed: false,
    });
  });

  it("allows only package scripts for validation", async () => {
    const dir = await tempDir("pi-web-validation-");
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ scripts: { test: "node -e 'process.exit(0)'" } }),
    );
    await expect(validationCommand(dir, "rm -rf .")).rejects.toThrow(/package/);
    expect(await validationCommand(dir, "npm test")).toEqual({
      cmd: "npm",
      args: ["test"],
    });
    expect((await runValidation(dir, "npm test")).ok).toBe(true);
  });

  it("parses issue references and PR command args", () => {
    expect(
      parseIssueReference("https://github.com/a/b/issues/12"),
    ).toMatchObject({ owner: "a", repo: "b", number: 12 });
    expect(parseIssueReference("#3")).toMatchObject({ number: 3 });
    expect(
      prCreateArgs({ title: "T", summary: "S", testing: "npm test" }),
    ).toContain("--draft");
  });

  it("round-trips MCP config without losing unknown fields", async () => {
    const path = join(process.env.PI_WEB_DATA_DIR ?? "", "mcp.json");
    await writeFile(path, JSON.stringify({ unknown: true, servers: {} }));
    await saveMcpServer("demo", { command: "echo" });
    expect(await readMcpConfig()).toMatchObject({
      unknown: true,
      servers: { demo: { command: "echo" } },
    });
  });

  it("guards instruction paths and warns on secret-like content", async () => {
    const dir = await tempDir("pi-web-rules-");
    await expect(saveInstructionFile(dir, "../AGENTS.md", "x")).rejects.toThrow(
      /escapes|allowed/,
    );
    expect(lintInstructionContent("TOKEN=abc")).toContain(
      "Possible secret-like line",
    );
    await saveInstructionFile(dir, "AGENTS.md", "# ok");
    expect(await readFile(join(dir, "AGENTS.md"), "utf8")).toBe("# ok");
  });

  it("resolves permission profiles", async () => {
    expect(toolsForPermissionProfile("safe", ["bash"])).toEqual([]);
    expect(toolsForPermissionProfile("full", ["bash"])).toEqual(["bash"]);
    expect(await permissionSettings("safe")).toMatchObject({ profile: "safe" });
  });

  it("reverts a single hunk via reverse patch", async () => {
    const dir = await repo();
    await writeFile(join(dir, "file.txt"), "two\n");

    const diff = await gitDiff(dir);
    expect(diff.patch).toContain("@@");
    const result = await revertGitChange(dir, { patch: diff.patch });
    expect(result).toMatchObject({ reverted: true, mode: "hunk" });
    expect(await readFile(join(dir, "file.txt"), "utf8")).toBe("one\n");
  });

  it("creates a pre-rewind checkpoint before rewinding", async () => {
    const dir = await repo();
    const checkpoint = await createCheckpoint(dir, "s1");
    await writeFile(join(dir, "file.txt"), "changed\n");

    await rewindCheckpoint(checkpoint.id, { confirmDelete: true });
    const labels = (await listCheckpoints({ cwd: dir })).map(
      (meta) => meta.label,
    );
    expect(labels).toContain("pre-rewind");
  });

  it("falls back to a prompt-only draft when gh is unavailable", async () => {
    const fail = async (): Promise<CommandResult> => ({
      code: 1,
      stdout: "",
      stderr: "gh: command not found",
      output: "gh: command not found",
    });
    const imported = await importIssue("#7", process.cwd(), fail);
    expect(imported.fallback).toBe(true);
    expect(imported.prompt).toContain("#7");

    const ok = async (): Promise<CommandResult> => ({
      code: 0,
      stdout: JSON.stringify({ title: "T", body: "B", url: "u" }),
      stderr: "",
      output: "",
    });
    expect(await importIssue("#7", process.cwd(), ok)).toMatchObject({
      title: "T",
      fallback: false,
    });
  });

  it("backs up and restores MCP config", async () => {
    await saveMcpServer("first", { command: "echo" });
    await saveMcpServer("second", { command: "cat" });
    const restored = await restoreMcpConfig();
    expect(Object.keys(restored.servers ?? {})).toEqual(["first"]);

    await saveMcpServer("first", null);
    expect(Object.keys((await readMcpConfig()).servers ?? {})).toEqual([]);
  });

  it("persists task cards and bookmarks across reloads", async () => {
    const task = await saveTask({ title: "Ship it", status: "review" });
    expect((await listTasks())[0]).toMatchObject({
      id: task.id,
      title: "Ship it",
      status: "review",
    });

    await saveBookmark({ sessionId: "s1", messageIndex: 2, excerpt: "hello" });
    expect(await listBookmarks()).toHaveLength(1);
    await saveBookmark({ sessionId: "s1", messageIndex: 2, remove: true });
    expect(await listBookmarks()).toHaveLength(0);
  });

  it("searches entries without mutating them and sorts diagnostics fail-first", async () => {
    const entries = [
      { message: { role: "user", content: "find the bug" }, timestamp: "t1" },
      { message: { role: "assistant", content: "done" } },
    ];
    const snapshot = JSON.stringify(entries);
    const results = searchSessionEntries("s1", entries, "bug", "t0");
    expect(results).toMatchObject([{ sessionId: "s1", messageIndex: 0 }]);
    expect(JSON.stringify(entries)).toBe(snapshot);
    expect(searchSessionEntries("s1", entries, "")).toEqual([]);

    const report = await diagnostics(await tempDir("pi-web-diag-"), {
      HOME: "/nonexistent-home",
    });
    const rank = { fail: 0, warn: 1, pass: 2 } as const;
    const ranks = report.items.map((item) => rank[item.status]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(report.items.map((item) => item.name)).toContain("Auth file");
  });

  it("runs golden tasks with a mocked prompt runner and records review", async () => {
    const fixture = join(process.cwd(), "docs", "golden-tasks", "_fixture.md");
    await writeFile(fixture, "# Fixture\n\n## Prompt\nSay hi");
    try {
      const result = await runGoldenTask("_fixture.md", async () => ({
        tokens: 12,
        cost: 0.5,
        sessionId: "eval-1",
      }));
      expect(result).toMatchObject({
        mode: "agent",
        tokens: 12,
        cost: 0.5,
        ok: true,
      });
      const reviewed = await reviewEvaluation(result.id, "accepted");
      expect(reviewed.review).toBe("accepted");
      await expect(reviewEvaluation(result.id, "bogus")).rejects.toThrow(
        /review/,
      );
    } finally {
      await rm(fixture, { force: true });
    }
  });

  it("redacts exports and parses golden tasks", () => {
    expect(redactSecrets("password=abc")).toBe("password=[redacted]");
    expect(
      parseGoldenTask(
        "# Demo\nverification: npm test\nexpectedFiles: a,b\n\n## Prompt\nDo it",
      ),
    ).toMatchObject({
      title: "Demo",
      prompt: "Do it",
      expectedFiles: ["a", "b"],
    });
  });
});
