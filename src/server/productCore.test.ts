import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createCheckpoint,
  createWorktree,
  git,
  gitDiff,
  lintInstructionContent,
  parseGoldenTask,
  parseIssueReference,
  permissionSettings,
  prCreateArgs,
  readMcpConfig,
  redactSecrets,
  removeWorktree,
  revertGitChange,
  rewindCheckpoint,
  runValidation,
  saveInstructionFile,
  saveMcpServer,
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
