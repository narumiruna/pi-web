// biome-ignore-all lint: product feature helpers intentionally handle JSON-shaped local state.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, constants as fsConstants } from "node:fs";
import {
  access,
  copyFile,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { resolveInside } from "./pathSafety.js";

export type CommandResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  output: string;
};
export type JsonObject = Record<string, unknown>;

const MAX_OUTPUT = 200_000;
const MAX_CHECKPOINT_FILE_BYTES = 1024 * 1024;

export function productDataDir() {
  return resolve(
    process.env.PI_WEB_DATA_DIR ?? join(process.cwd(), "data", "pi-web"),
  );
}

export async function ensureDir(path: string) {
  await mkdir(path, { recursive: true });
}

export async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export async function writeJson(path: string, value: unknown) {
  await ensureDir(dirname(path));
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temp, path);
}

export async function runProcess(
  cmd: string,
  args: string[],
  options: {
    cwd: string;
    input?: string;
    timeoutMs?: number;
    env?: NodeJS.ProcessEnv;
  },
): Promise<CommandResult> {
  return new Promise((resolveResult) => {
    const child = spawn(cmd, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const append = (target: "stdout" | "stderr", chunk: Buffer) => {
      if (target === "stdout") stdout += chunk.toString();
      else stderr += chunk.toString();
      if (stdout.length > MAX_OUTPUT) stdout = stdout.slice(-MAX_OUTPUT);
      if (stderr.length > MAX_OUTPUT) stderr = stderr.slice(-MAX_OUTPUT);
    };
    const timer = setTimeout(() => child.kill(), options.timeoutMs ?? 30_000);
    child.stdout.on("data", (chunk) => append("stdout", chunk));
    child.stderr.on("data", (chunk) => append("stderr", chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      resolveResult({
        code: 1,
        stdout,
        stderr: error.message,
        output: error.message,
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const output = `${stdout}${stderr}`;
      resolveResult({ code, stdout, stderr, output });
    });
    if (options.input !== undefined) {
      child.stdin.write(options.input);
      child.stdin.end();
    }
  });
}

export async function git(cwd: string, args: string[], input?: string) {
  return runProcess("git", args, { cwd, input, timeoutMs: 30_000 });
}

export async function gitDiff(cwd: string) {
  const root = resolve(cwd);
  const top = await git(root, ["rev-parse", "--show-toplevel"]);
  if (top.code !== 0)
    return {
      isRepo: false,
      files: [],
      patch: "",
      stat: "",
      error: top.output.trim(),
    };
  const repo = top.stdout.trim();
  const [patch, stat, status] = await Promise.all([
    git(repo, ["diff", "--binary", "--src-prefix=a/", "--dst-prefix=b/"]),
    git(repo, ["diff", "--stat"]),
    git(repo, ["status", "--porcelain=v1"]),
  ]);
  const files = status.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => ({
      status: line.slice(0, 2).trim() || "M",
      path: line.slice(3).trim(),
    }));
  return {
    isRepo: true,
    cwd: repo,
    files,
    patch: patch.stdout,
    stat: stat.stdout,
    error: patch.code === 0 ? "" : patch.stderr,
  };
}

export async function revertGitChange(
  cwd: string,
  body: { path?: string; patch?: string },
) {
  const root = resolve(cwd);
  if (body.patch) {
    const result = await git(
      root,
      ["apply", "-R", "--whitespace=nowarn"],
      body.patch,
    );
    if (result.code !== 0)
      throw new Error(result.output || "Failed to reverse patch");
    return { reverted: true, mode: "hunk" };
  }
  if (!body.path) throw new Error("path or patch is required");
  const path = relative(root, resolveInside(root, body.path));
  const checkout = await git(root, ["checkout", "--", path]);
  if (checkout.code !== 0) {
    const clean = await git(root, ["clean", "-fd", "--", path]);
    if (clean.code !== 0)
      throw new Error(`${checkout.output}${clean.output}`.trim());
  }
  return { reverted: true, mode: "file", path };
}

export type CheckpointMeta = {
  id: string;
  cwd: string;
  sessionId?: string;
  label?: string;
  created: string;
  untracked: string[];
};

function checkpointDir(id = "") {
  return join(productDataDir(), "checkpoints", id);
}

async function copyUntracked(cwd: string, root: string, files: string[]) {
  for (const file of files) {
    const source = resolveInside(cwd, file);
    const info = await stat(source).catch(() => undefined);
    if (!info?.isFile() || info.size > MAX_CHECKPOINT_FILE_BYTES) continue;
    const target = join(root, "files", file);
    await ensureDir(dirname(target));
    await copyFile(source, target);
  }
}

async function gitUntracked(cwd: string) {
  const result = await git(cwd, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
  ]);
  return result.stdout.split("\0").filter(Boolean);
}

export async function createCheckpoint(
  cwd: string,
  sessionId?: string,
  label?: string,
): Promise<CheckpointMeta> {
  const root = resolve(cwd);
  const repo = await git(root, ["rev-parse", "--show-toplevel"]);
  if (repo.code !== 0) throw new Error("Checkpoints require a git repository");
  const actualCwd = repo.stdout.trim();
  const id = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const dir = checkpointDir(id);
  await ensureDir(dir);
  const [diff, staged, untracked] = await Promise.all([
    git(actualCwd, ["diff", "--binary"]),
    git(actualCwd, ["diff", "--cached", "--binary"]),
    gitUntracked(actualCwd),
  ]);
  await writeFile(join(dir, "diff.patch"), diff.stdout);
  await writeFile(join(dir, "staged.patch"), staged.stdout);
  await copyUntracked(actualCwd, dir, untracked);
  const meta = {
    id,
    cwd: actualCwd,
    sessionId,
    label,
    created: new Date().toISOString(),
    untracked,
  };
  await writeJson(join(dir, "meta.json"), meta);
  return meta;
}

export async function listCheckpoints(
  filter: { cwd?: string; sessionId?: string } = {},
) {
  const root = checkpointDir();
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const metas = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) =>
        readJson<CheckpointMeta | undefined>(
          join(root, entry.name, "meta.json"),
          undefined,
        ),
      ),
  );
  return metas
    .filter((meta): meta is CheckpointMeta => Boolean(meta))
    .filter((meta) => !filter.cwd || resolve(meta.cwd) === resolve(filter.cwd))
    .filter((meta) => !filter.sessionId || meta.sessionId === filter.sessionId)
    .sort((a, b) => b.created.localeCompare(a.created));
}

async function restoreCheckpointFiles(meta: CheckpointMeta, dir: string) {
  for (const file of meta.untracked) {
    const source = join(dir, "files", file);
    if (!existsSync(source)) continue;
    const target = resolveInside(meta.cwd, file);
    await ensureDir(dirname(target));
    await copyFile(source, target);
  }
}

export async function rewindCheckpoint(
  id: string,
  options: { confirmDelete?: boolean } = {},
) {
  const dir = checkpointDir(id);
  const meta = await readJson<CheckpointMeta | undefined>(
    join(dir, "meta.json"),
    undefined,
  );
  if (!meta) throw new Error("Checkpoint not found");
  const currentUntracked = await gitUntracked(meta.cwd);
  const checkpointUntracked = new Set(meta.untracked);
  const createdAfter = currentUntracked.filter(
    (file) => !checkpointUntracked.has(file),
  );
  if (createdAfter.length && !options.confirmDelete)
    return { rewound: false, requiresConfirmation: true, files: createdAfter };
  if (meta.label !== "pre-rewind")
    await createCheckpoint(meta.cwd, meta.sessionId, "pre-rewind").catch(
      () => undefined,
    );
  const reset = await git(meta.cwd, ["reset", "--hard"]);
  const clean = await git(meta.cwd, ["clean", "-fd"]);
  if (reset.code !== 0 || clean.code !== 0)
    throw new Error(`${reset.output}${clean.output}`.trim());
  const diff = await readFile(join(dir, "diff.patch"), "utf8").catch(() => "");
  const staged = await readFile(join(dir, "staged.patch"), "utf8").catch(
    () => "",
  );
  if (diff.trim()) {
    const apply = await git(meta.cwd, ["apply", "--whitespace=nowarn"], diff);
    if (apply.code !== 0)
      throw new Error(apply.output || "Failed to apply checkpoint diff");
  }
  if (staged.trim()) {
    const applyStaged = await git(
      meta.cwd,
      ["apply", "--cached", "--whitespace=nowarn"],
      staged,
    );
    if (applyStaged.code !== 0)
      throw new Error(
        applyStaged.output || "Failed to apply staged checkpoint diff",
      );
  }
  await restoreCheckpointFiles(meta, dir);
  return { rewound: true, checkpoint: meta };
}

export async function validationCommand(cwd: string, command: string) {
  const trimmed = command.trim();
  const pkg = await readJson<{ scripts?: Record<string, string> }>(
    join(cwd, "package.json"),
    {},
  );
  const scripts = new Set(Object.keys(pkg.scripts ?? {}));
  if (trimmed === "npm test" && scripts.has("test"))
    return { cmd: "npm", args: ["test"] };
  const match = /^npm run ([\w:-]+)$/.exec(trimmed);
  if (match && scripts.has(match[1]))
    return { cmd: "npm", args: ["run", match[1]] };
  throw new Error("Command is not in package.json scripts");
}

export async function runValidation(cwd: string, command: string) {
  const allowed = await validationCommand(cwd, command);
  const result = await runProcess(allowed.cmd, allowed.args, {
    cwd,
    timeoutMs: 120_000,
  });
  return {
    command,
    code: result.code,
    output: result.output.slice(-MAX_OUTPUT),
    ok: result.code === 0,
    finishedAt: new Date().toISOString(),
  };
}

export function parseIssueReference(input: string, cwd = process.cwd()) {
  const trimmed = input.trim();
  const url = trimmed.match(/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/);
  if (url)
    return {
      owner: url[1],
      repo: url[2],
      number: Number(url[3]),
      selector: url[3],
    };
  const num = /^#?(\d+)$/.exec(trimmed);
  if (num) return { number: Number(num[1]), selector: num[1], cwd };
  throw new Error("Use a GitHub issue URL or number");
}

export async function importIssue(
  input: string,
  cwd: string,
  runner = runProcess,
) {
  const ref = parseIssueReference(input, cwd);
  const repoArg = "owner" in ref ? ["--repo", `${ref.owner}/${ref.repo}`] : [];
  const result = await runner(
    "gh",
    [
      "issue",
      "view",
      String(ref.number),
      "--json",
      "title,body,url",
      ...repoArg,
    ],
    { cwd, timeoutMs: 30_000 },
  );
  if (result.code !== 0) {
    // gh missing or unauthenticated: keep the flow alive with a prompt-only draft.
    return {
      title: `Issue #${ref.number}`,
      body: "",
      url: input,
      prompt: `Implement GitHub issue #${ref.number} (${input}).\n\nThe gh CLI was unavailable, so read the issue yourself if possible.\n\nAcceptance criteria:\n- Resolve the issue completely.`,
      fallback: true,
      error: result.output.trim() || "gh issue view failed",
    };
  }
  const issue = JSON.parse(result.stdout || "{}");
  return {
    title: issue.title ?? `Issue #${ref.number}`,
    body: issue.body ?? "",
    url: issue.url ?? input,
    prompt: `Implement GitHub issue #${ref.number}: ${issue.title ?? ""}\n\n${issue.body ?? ""}\n\nAcceptance criteria:\n- Resolve the issue completely.`,
    fallback: false,
  };
}

export function prCreateArgs(body: {
  title?: string;
  summary?: string;
  testing?: string;
  draft?: boolean;
}) {
  const title = body.title?.trim() || "Implement pi-web roadmap features";
  const prBody = `## Summary\n${body.summary?.trim() || "Implemented pi-web roadmap features."}\n\n## Testing\n${body.testing?.trim() || "Not run."}`;
  return [
    "pr",
    "create",
    body.draft === false ? "" : "--draft",
    "--title",
    title,
    "--body",
    prBody,
  ].filter(Boolean);
}

export async function createDraftPr(
  cwd: string,
  body: { title?: string; summary?: string; testing?: string; draft?: boolean },
) {
  const result = await runProcess("gh", prCreateArgs(body), {
    cwd,
    timeoutMs: 30_000,
  });
  if (result.code !== 0)
    throw new Error(result.output || "gh pr create failed");
  return { url: result.stdout.trim() };
}

export type McpConfig = {
  servers?: Record<string, JsonObject>;
  [key: string]: unknown;
};
function mcpPath() {
  return join(productDataDir(), "mcp.json");
}
export async function readMcpConfig() {
  return readJson<McpConfig>(mcpPath(), { servers: {} });
}
export async function saveMcpServer(name: string, server: JsonObject | null) {
  const config = await readMcpConfig();
  if (existsSync(mcpPath())) await copyFile(mcpPath(), `${mcpPath()}.bak`);
  const servers = { ...(config.servers ?? {}) };
  if (server === null) delete servers[name];
  else servers[name] = server;
  config.servers = servers;
  await writeJson(mcpPath(), config);
  return config;
}
export async function restoreMcpConfig() {
  const backup = `${mcpPath()}.bak`;
  if (!existsSync(backup)) throw new Error("No MCP config backup found");
  await copyFile(backup, mcpPath());
  return readMcpConfig();
}

const instructionNames = new Set(["AGENTS.md", "CLAUDE.md", "README.md"]);
export function isAllowedInstructionPath(cwd: string, requested: string) {
  const file = resolveInside(cwd, requested);
  const rel = relative(resolve(cwd), file).replaceAll("\\", "/");
  return instructionNames.has(basename(rel)) || rel.startsWith(".pi/");
}
export async function discoverInstructionFiles(cwd: string) {
  const candidates = [
    "AGENTS.md",
    "CLAUDE.md",
    ".pi/SYSTEM.md",
    ".pi/APPEND_SYSTEM.md",
    ".pi/settings.json",
  ];
  return Promise.all(
    candidates.map(async (path) => {
      const file = resolve(cwd, path);
      const exists = existsSync(file);
      return {
        path,
        exists,
        modified: exists
          ? (await stat(file).catch(() => undefined))?.mtime.toISOString()
          : undefined,
        warnings: exists
          ? lintInstructionContent(await readFile(file, "utf8"))
          : [],
      };
    }),
  );
}
export function lintInstructionContent(content: string) {
  const warnings: string[] = [];
  if (!content.trim()) warnings.push("File is empty");
  if (content.length > 100_000) warnings.push("File is very large");
  if (/(api[_-]?key|token|password|secret)\s*[:=]\s*\S+/i.test(content))
    warnings.push("Possible secret-like line");
  return warnings;
}
export async function readInstructionFile(cwd: string, requested: string) {
  if (!isAllowedInstructionPath(cwd, requested))
    throw new Error("Instruction path is not allowed");
  const file = resolveInside(cwd, requested);
  return {
    path: relative(resolve(cwd), file),
    content: await readFile(file, "utf8"),
    warnings: lintInstructionContent(await readFile(file, "utf8")),
  };
}
export async function saveInstructionFile(
  cwd: string,
  requested: string,
  content: string,
) {
  if (!isAllowedInstructionPath(cwd, requested))
    throw new Error("Instruction path is not allowed");
  const file = resolveInside(cwd, requested);
  await ensureDir(dirname(file));
  if (existsSync(file)) await copyFile(file, `${file}.bak`);
  await writeFile(file, content);
  return {
    path: relative(resolve(cwd), file),
    warnings: lintInstructionContent(content),
  };
}
export async function restoreInstructionFile(cwd: string, requested: string) {
  const file = resolveInside(cwd, requested);
  const backup = `${file}.bak`;
  if (!existsSync(backup)) throw new Error("No backup found");
  await copyFile(backup, file);
  return readInstructionFile(cwd, requested);
}

export type PermissionProfile = "safe" | "ask" | "full";
export function resolvePermissionProfile(value?: string): PermissionProfile {
  return value === "safe" || value === "ask" || value === "full"
    ? value
    : "ask";
}
export function toolsForPermissionProfile(profile?: string, tools?: string[]) {
  const resolved = resolvePermissionProfile(profile);
  if (resolved === "full") return tools;
  if (resolved === "safe") return [];
  return tools;
}
export async function permissionSettings(profile?: string) {
  const path = join(productDataDir(), "permissions.json");
  if (profile)
    await writeJson(path, { profile: resolvePermissionProfile(profile) });
  const current = await readJson<{ profile?: PermissionProfile }>(path, {
    profile: "ask",
  });
  return {
    profile: resolvePermissionProfile(current.profile),
    safeMode: process.env.PI_WEB_SAFE_MODE === "1",
    approval: "profile-only",
  };
}

export function usageFromStatus(status: any) {
  const tokens = status?.tokens ?? {};
  return {
    inputTokens: Number(tokens.input ?? tokens.prompt ?? 0),
    outputTokens: Number(tokens.output ?? tokens.completion ?? 0),
    cost: Number(status?.cost ?? 0),
    contextPercent: Number(
      status?.contextUsage?.percentage ?? status?.contextUsage?.percent ?? 0,
    ),
    toolCount: Array.isArray(status?.activeTools)
      ? status.activeTools.length
      : 0,
  };
}

function bookmarksPath() {
  return join(productDataDir(), "bookmarks.json");
}
export async function listBookmarks() {
  return readJson<any[]>(bookmarksPath(), []);
}
export async function saveBookmark(bookmark: any) {
  const bookmarks = await listBookmarks();
  const key = `${bookmark.sessionId}:${bookmark.messageIndex ?? bookmark.leafId ?? ""}`;
  const next = bookmarks.filter(
    (item) =>
      `${item.sessionId}:${item.messageIndex ?? item.leafId ?? ""}` !== key,
  );
  if (!bookmark.remove)
    next.push({ ...bookmark, created: new Date().toISOString() });
  await writeJson(bookmarksPath(), next);
  return next;
}

function textFromContent(content: any): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map(
      (part) =>
        part?.text ?? part?.thinking ?? (part?.type ? `[${part.type}]` : ""),
    )
    .join("\n");
}

export function redactSecrets(text: string) {
  return text.replace(
    /((?:api[_-]?key|token|password|secret)\s*[:=]\s*)\S+/gi,
    "$1[redacted]",
  );
}

export function sessionExport(
  messages: any[],
  format: "json" | "md",
  extras: { tree?: unknown; status?: unknown } = {},
) {
  if (format === "json")
    return JSON.stringify(
      {
        messages: messages.map((message) => ({
          ...message,
          content: redactSecrets(JSON.stringify(message.content)),
        })),
        tree: extras.tree
          ? JSON.parse(redactSecrets(JSON.stringify(extras.tree)))
          : undefined,
        status: extras.status
          ? JSON.parse(redactSecrets(JSON.stringify(extras.status)))
          : undefined,
      },
      null,
      2,
    );
  return messages
    .map(
      (message) =>
        `## ${message.role ?? "event"}\n\n${redactSecrets(textFromContent(message.content))}`,
    )
    .join("\n\n");
}

export function searchSessionEntries(
  sessionId: string,
  entries: any[],
  query: string,
  fallbackTimestamp = "",
) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const results: any[] = [];
  entries.forEach((entry: any, index: number) => {
    const message = entry.message;
    const text = textFromContent(message?.content);
    if (text.toLowerCase().includes(q))
      results.push({
        sessionId,
        messageIndex: index,
        role: message?.role,
        excerpt: text.slice(0, 240),
        timestamp: entry.timestamp ?? fallbackTimestamp,
      });
  });
  return results;
}

export async function searchSessions(query: string) {
  if (!query.trim()) return [];
  const sessions = await SessionManager.listAll();
  const results: any[] = [];
  for (const session of sessions) {
    const manager = SessionManager.open(session.path);
    results.push(
      ...searchSessionEntries(
        session.id,
        manager.getEntries(),
        query,
        session.modified.toISOString(),
      ),
    );
  }
  return results.slice(0, 50);
}

function tasksPath() {
  return join(productDataDir(), "tasks.json");
}
export async function listTasks() {
  return readJson<any[]>(tasksPath(), []);
}
export async function saveTask(task: any) {
  const tasks = await listTasks();
  const now = new Date().toISOString();
  const nextTask = {
    id: task.id || randomUUID(),
    status: task.status || "todo",
    created: task.created || now,
    updated: now,
    ...task,
  };
  const next = [...tasks.filter((item) => item.id !== nextTask.id), nextTask];
  await writeJson(tasksPath(), next);
  return nextTask;
}
export async function deleteTask(id: string) {
  const tasks = (await listTasks()).filter((task) => task.id !== id);
  await writeJson(tasksPath(), tasks);
  return tasks;
}

const DIAGNOSTIC_ORDER = { fail: 0, warn: 1, pass: 2 } as const;
export type DiagnosticItem = {
  name: string;
  status: "pass" | "warn" | "fail";
  detail: string;
  fix?: string;
};

export async function diagnostics(cwd: string, env = process.env) {
  const items: DiagnosticItem[] = [];
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  items.push({
    name: "Node.js",
    status: nodeMajor >= 22 ? "pass" : "fail",
    detail: process.versions.node,
    fix: "Use Node.js 22 or newer.",
  });
  const agentDir =
    env.PI_CODING_AGENT_DIR ?? join(env.HOME ?? "", ".pi", "agent");
  items.push({
    name: "Agent dir",
    status: existsSync(agentDir) ? "pass" : "warn",
    detail: agentDir,
    fix: "Install pi-coding-agent or set PI_CODING_AGENT_DIR.",
  });
  const authFile = join(agentDir, "auth.json");
  const hasAuthFile = existsSync(authFile);
  const hasEnvKey = [
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "GOOGLE_API_KEY",
  ].some((key) => Boolean(env[key]));
  items.push({
    name: "Auth file",
    status: hasAuthFile ? "pass" : "warn",
    detail: authFile,
    fix: "Save an API key in Control room to create it.",
  });
  items.push({
    name: "API keys",
    status: hasEnvKey ? "pass" : "warn",
    detail: "ANTHROPIC_API_KEY / OPENAI_API_KEY / GOOGLE_API_KEY env",
    fix: "Save an API key in Control room.",
  });
  items.push({
    name: "Models",
    status: hasAuthFile || hasEnvKey ? "pass" : "fail",
    detail:
      hasAuthFile || hasEnvKey
        ? "Provider credentials present"
        : "No credentials; the model list will be empty",
    fix: "Configure at least one provider API key.",
  });
  await access(cwd, fsConstants.W_OK)
    .then(() =>
      items.push({ name: "Workspace access", status: "pass", detail: cwd }),
    )
    .catch((error) =>
      items.push({
        name: "Workspace access",
        status: "fail",
        detail: error.message,
        fix: "Point cwd at a writable workspace directory.",
      }),
    );
  items.push({
    name: "Shell",
    status: existsSync(env.PI_WEB_SHELL || "/bin/sh") ? "pass" : "warn",
    detail: env.PI_WEB_SHELL || "/bin/sh",
    fix: "Set PI_WEB_SHELL to an existing shell binary.",
  });
  items.sort((a, b) => DIAGNOSTIC_ORDER[a.status] - DIAGNOSTIC_ORDER[b.status]);
  return { items };
}

export async function listWorktrees(cwd: string) {
  const result = await git(cwd, ["worktree", "list", "--porcelain"]);
  if (result.code !== 0) return [];
  return result.stdout
    .split("\n\n")
    .filter(Boolean)
    .map((block) =>
      Object.fromEntries(
        block.split("\n").map((line) => {
          const [key, ...rest] = line.split(" ");
          return [key, rest.join(" ") || true];
        }),
      ),
    );
}
export async function createWorktree(cwd: string, title = "task") {
  const safe =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "task";
  const root = join(productDataDir(), "worktrees");
  await ensureDir(root);
  const suffix = Date.now().toString(36);
  const branch = `pi-web/${safe}-${suffix}`;
  const path = join(root, `${safe}-${suffix}`);
  const result = await git(cwd, ["worktree", "add", "-b", branch, path]);
  if (result.code !== 0)
    throw new Error(result.output || "git worktree add failed");
  return { branch, cwd: path };
}
export async function removeWorktree(
  repoCwd: string,
  path: string,
  force = false,
) {
  const status = await git(path, ["status", "--porcelain"]);
  if (status.stdout.trim() && !force) return { removed: false, dirty: true };
  const owner =
    (await listWorktrees(path)).find(
      (item) => String(item.worktree) !== resolve(path),
    )?.worktree ?? repoCwd;
  const result = await git(
    String(owner),
    ["worktree", "remove", force ? "--force" : "", path].filter(Boolean),
  );
  if (result.code !== 0)
    throw new Error(result.output || "git worktree remove failed");
  return { removed: true };
}

export type GoldenTask = {
  title: string;
  cwd?: string;
  prompt: string;
  command?: string;
  expectedFiles: string[];
};
export function parseGoldenTask(markdown: string): GoldenTask {
  const title = /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim() || "Untitled";
  const field = (name: string) =>
    new RegExp(`^${name}:\\s*(.+)$`, "im").exec(markdown)?.[1]?.trim();
  const prompt =
    /##\s*Prompt\s*\n([\s\S]*?)(?:\n##\s|$)/i.exec(markdown)?.[1]?.trim() || "";
  if (!prompt) throw new Error("Golden task prompt is required");
  return {
    title,
    cwd: field("cwd"),
    prompt,
    command: field("verification"),
    expectedFiles: (field("expectedFiles") ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  };
}
export async function loadGoldenTasks() {
  const dir = resolve(process.cwd(), "docs", "golden-tasks");
  const files = await readdir(dir).catch(() => []);
  return Promise.all(
    files
      .filter((file) => file.endsWith(".md"))
      .map(async (file) => ({
        file,
        ...parseGoldenTask(await readFile(join(dir, file), "utf8")),
      })),
  );
}
export type GoldenPromptRunner = (
  task: GoldenTask,
  cwd: string,
) => Promise<{ tokens?: number; cost?: number; sessionId?: string }>;

function evaluationsPath() {
  return join(productDataDir(), "evaluations.json");
}

export async function runGoldenTask(
  file: string,
  promptRunner?: GoldenPromptRunner,
) {
  const taskPath = resolveInside(
    resolve(process.cwd(), "docs", "golden-tasks"),
    file,
  );
  const task = parseGoldenTask(await readFile(taskPath, "utf8"));
  const cwd = task.cwd ? resolve(process.cwd(), task.cwd) : process.cwd();
  const started = Date.now();
  const agent = promptRunner ? await promptRunner(task, cwd) : undefined;
  const validation = task.command
    ? await runValidation(cwd, task.command)
    : {
        ok: true,
        code: 0,
        output: "No verification command",
        command: "",
        finishedAt: new Date().toISOString(),
      };
  const result = {
    id: randomUUID(),
    task: file,
    mode: promptRunner ? "agent" : "dry-run",
    ok: validation.ok,
    code: validation.code,
    output: validation.output,
    durationMs: Date.now() - started,
    cost: agent?.cost ?? 0,
    tokens: agent?.tokens ?? 0,
    sessionId: agent?.sessionId,
    review: "",
    created: new Date().toISOString(),
  };
  const path = evaluationsPath();
  await writeJson(path, [...(await readJson<any[]>(path, [])), result]);
  return result;
}

export async function reviewEvaluation(id: string, review: string) {
  if (review !== "accepted" && review !== "rejected" && review !== "")
    throw new Error("review must be accepted, rejected, or empty");
  const path = evaluationsPath();
  const results = await readJson<any[]>(path, []);
  const target = results.find((item) => item.id === id);
  if (!target) throw new Error("Evaluation result not found");
  target.review = review;
  await writeJson(path, results);
  return target;
}

export async function tempRepo(prefix = "pi-web-") {
  const dir = join(tmpdir(), `${prefix}${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}
