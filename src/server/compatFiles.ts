// biome-ignore-all lint: compatibility routes intentionally accept third-party wire shapes.
import { existsSync, statSync, watch } from "node:fs";
import {
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  extname,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";
import {
  errorMessage,
  expandHome,
  isText,
  mimeFromPath,
  projectsPath,
  readJson,
  runCommand,
  writeJson,
} from "./compatShared.js";
import type { CompatDeps as Deps, StoredProject } from "./compatTypes.js";
import { resolveInside } from "./pathSafety.js";
import { imageMimeFromPath, readWorkspaceImage } from "./workspaceImages.js";

export function registerFileCompatRoutes(app: FastifyInstance, deps: Deps) {
  app.get<{ Params: { "*": string }; Querystring: { type?: string } }>(
    "/api/files/*",
    async (request, reply) => {
      const file = absoluteFromWildcard(request.params["*"]);
      const type = request.query.type ?? "read";
      if (type === "list")
        return { entries: await fileEntries(file), path: file };
      if (type === "meta") return fileMeta(file);
      if (type === "watch") return fileWatch(reply, file);
      return reply.type(mimeFromPath(file)).send(await readFile(file));
    },
  );
  for (const prefix of ["/api", "/api/machines/local"])
    registerWorkspaceRoutes(app, deps, prefix);
}

function registerWorkspaceRoutes(
  app: FastifyInstance,
  deps: Deps,
  prefix: string,
) {
  app.get<{
    Params: { projectId: string; workspaceId: string };
    Querystring: { path?: string };
  }>(
    `${prefix}/projects/:projectId/workspaces/:workspaceId/tree`,
    async (request) => ({
      entries: await workspaceEntries(
        deps,
        request.params.projectId,
        request.params.workspaceId,
        request.query.path,
      ),
      path: request.query.path ?? "",
    }),
  );
  app.get<{
    Params: { projectId: string; workspaceId: string };
    Querystring: { path?: string };
  }>(
    `${prefix}/projects/:projectId/workspaces/:workspaceId/file`,
    async (request) =>
      readWorkspaceFile(
        await workspaceRoot(
          deps,
          request.params.projectId,
          request.params.workspaceId,
        ),
        request.query.path,
      ),
  );
  app.put<{
    Params: { projectId: string; workspaceId: string };
    Querystring: { path?: string; createDirs?: string; overwrite?: string };
    Body: Buffer;
  }>(
    `${prefix}/projects/:projectId/workspaces/:workspaceId/file`,
    async (request, reply) =>
      writeWorkspaceFile(
        reply,
        await workspaceRoot(
          deps,
          request.params.projectId,
          request.params.workspaceId,
        ),
        request.query.path,
        request.body,
        request.query,
      ),
  );
  app.delete<{
    Params: { projectId: string; workspaceId: string };
    Querystring: { path?: string };
  }>(
    `${prefix}/projects/:projectId/workspaces/:workspaceId/file`,
    async (request) =>
      deleteWorkspaceFile(
        await workspaceRoot(
          deps,
          request.params.projectId,
          request.params.workspaceId,
        ),
        request.query.path,
      ),
  );
  app.post<{
    Params: { projectId: string; workspaceId: string };
    Querystring: { fromPath?: string; toPath?: string; overwrite?: string };
  }>(
    `${prefix}/projects/:projectId/workspaces/:workspaceId/file/move`,
    async (request) =>
      moveWorkspaceFile(
        await workspaceRoot(
          deps,
          request.params.projectId,
          request.params.workspaceId,
        ),
        request.query.fromPath,
        request.query.toPath,
        request.query.overwrite === "true",
      ),
  );
  app.get<{
    Params: { projectId: string; workspaceId: string };
    Querystring: { path?: string };
  }>(
    `${prefix}/projects/:projectId/workspaces/:workspaceId/file/preview`,
    async (request, reply) => {
      const root = await workspaceRoot(
        deps,
        request.params.projectId,
        request.params.workspaceId,
      );
      const file = resolveInside(root, request.query.path ?? ".");
      if (imageMimeFromPath(file)) {
        const image = await readWorkspaceImage(root, request.query.path ?? ".");
        return reply.type(image.mimeType).send(image.data);
      }
      return reply.type(mimeFromPath(file)).send(await readFile(file));
    },
  );
  app.get<{
    Params: { projectId: string; workspaceId: string };
    Querystring: { q?: string; mode?: string };
  }>(
    `${prefix}/projects/:projectId/workspaces/:workspaceId/files`,
    async (request) =>
      listSuggestions(
        await workspaceRoot(
          deps,
          request.params.projectId,
          request.params.workspaceId,
        ),
        request.query.q ?? "",
        request.query.mode === "path",
      ),
  );
  app.get<{ Params: { projectId: string; workspaceId: string } }>(
    `${prefix}/projects/:projectId/workspaces/:workspaceId/git/status`,
    async (request) =>
      gitStatus(
        await workspaceRoot(
          deps,
          request.params.projectId,
          request.params.workspaceId,
        ),
      ),
  );
  app.get<{
    Params: { projectId: string; workspaceId: string };
    Querystring: { path?: string; staged?: string };
  }>(
    `${prefix}/projects/:projectId/workspaces/:workspaceId/git/diff`,
    async (request) =>
      gitDiff(
        await workspaceRoot(
          deps,
          request.params.projectId,
          request.params.workspaceId,
        ),
        request.query.path,
        request.query.staged === "true",
      ),
  );
}

export function registerProjectRoutes(
  app: FastifyInstance,
  deps: Deps,
  listTerminals: (cwd: string) => unknown[],
) {
  for (const prefix of ["/api", "/api/machines/local"]) {
    app.get(`${prefix}/projects`, async () => ({
      projects: await listProjects(deps.defaultCwd),
    }));
    app.post<{ Body: { name?: string; path: string; create?: boolean } }>(
      `${prefix}/projects`,
      async (request, reply) => {
        try {
          return await addProject(request.body, deps.defaultCwd);
        } catch (error) {
          return reply.code(400).send({ error: errorMessage(error) });
        }
      },
    );
    app.delete<{ Params: { projectId: string } }>(
      `${prefix}/projects/:projectId`,
      async (request) => ({
        closed: await removeProject(request.params.projectId),
      }),
    );
    app.get<{ Querystring: { q?: string } }>(
      `${prefix}/project-directories`,
      async (request) => directorySuggestions(request.query.q ?? ""),
    );
    app.get<{ Params: { projectId: string } }>(
      `${prefix}/projects/:projectId/workspaces`,
      async (request) =>
        workspacesFor(
          await requireProject(request.params.projectId, deps.defaultCwd),
        ),
    );
    app.get(`${prefix}/activity`, async () => ({
      sessions: [],
      terminals: listTerminals(deps.defaultCwd),
      updatedAt: new Date().toISOString(),
    }));
  }
}

function absoluteFromWildcard(path: string) {
  return resolve(sep + path.split("/").map(decodeURIComponent).join(sep));
}

async function fileEntries(dir: string) {
  return (await readdir(dir, { withFileTypes: true }))
    .filter((entry) => entry.name !== "node_modules" && entry.name !== ".git")
    .map((entry) => {
      const full = join(dir, entry.name);
      const info = statSync(full);
      return {
        name: entry.name,
        isDir: entry.isDirectory(),
        size: info.size,
        modified: info.mtime.toISOString(),
      };
    });
}

async function fileMeta(file: string) {
  const info = await stat(file);
  return {
    path: file,
    size: info.size,
    modified: info.mtime.toISOString(),
    mimeType: mimeFromPath(file),
    language: extname(file).slice(1),
    binary: !isText(file),
  };
}

function fileWatch(reply: FastifyReply, file: string) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (event: unknown) =>
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        );
      send({ type: "ready" });
      const watcher = watch(file, () =>
        send({ type: "change", at: Date.now() }),
      );
      setTimeout(() => {
        watcher.close();
        controller.close();
      }, 300_000);
    },
  });
  return reply.header("Content-Type", "text/event-stream").send(stream);
}

async function workspaceEntries(
  deps: Deps,
  projectId: string,
  workspaceId: string,
  path = "",
) {
  const root = await workspaceRoot(deps, projectId, workspaceId);
  const dir = resolveInside(root, path || ".");
  return (await fileEntries(dir)).map((entry: any) => ({
    name: entry.name,
    path: relative(root, join(dir, entry.name)),
    type: entry.isDir ? "directory" : "file",
    isDir: entry.isDir,
    size: entry.size,
    modified: entry.modified,
  }));
}

async function readWorkspaceFile(root: string, path = ".") {
  const file = resolveInside(root, path);
  const info = await stat(file);
  const mimeType = mimeFromPath(file);
  if (!isText(file) || info.size > 2 * 1024 * 1024)
    return { path, size: info.size, binary: true, mimeType, content: "" };
  return {
    path,
    size: info.size,
    binary: false,
    mimeType,
    content: await readFile(file, "utf8"),
    truncated: false,
  };
}

async function writeWorkspaceFile(
  reply: FastifyReply,
  root: string,
  path = "",
  body: Buffer,
  query: any,
) {
  if (!path) return reply.code(400).send({ error: "path required" });
  const file = resolveInside(root, path);
  if (query.overwrite === "false" && existsSync(file))
    return reply.code(409).send({ error: "File exists" });
  if (query.createDirs !== "false")
    await mkdir(dirname(file), { recursive: true });
  await writeFile(file, body);
  return { path, size: body.length, written: true };
}

async function deleteWorkspaceFile(root: string, path = "") {
  const file = resolveInside(root, path);
  const existed = existsSync(file);
  if (existed) await rm(file, { force: true });
  return { path, existed, deleted: existed };
}

async function moveWorkspaceFile(
  root: string,
  fromPath = "",
  toPath = "",
  overwrite = false,
) {
  const from = resolveInside(root, fromPath);
  const to = resolveInside(root, toPath);
  if (!overwrite && existsSync(to)) throw new Error("Target exists");
  await mkdir(dirname(to), { recursive: true });
  await rename(from, to);
  return { fromPath, toPath, moved: true };
}

async function workspaceRoot(
  deps: Deps,
  projectId: string,
  workspaceId: string,
) {
  const project = await requireProject(projectId, deps.defaultCwd);
  if (workspaceId === "root") return project.path;
  return Buffer.from(workspaceId, "base64url").toString("utf8");
}

async function listProjects(defaultCwd: string): Promise<StoredProject[]> {
  const stored = (await readJson(projectsPath(), [])) as StoredProject[];
  const fallback = projectFromPath(defaultCwd);
  return stored.some((project) => project.path === fallback.path)
    ? stored
    : [fallback, ...stored];
}

async function addProject(
  input: { name?: string; path?: string; create?: boolean },
  defaultCwd: string,
) {
  const path = resolve(expandHome(input.path || defaultCwd));
  if (input.create) await mkdir(path, { recursive: true });
  if (!statSync(path).isDirectory())
    throw new Error("Project path must be a directory");
  const projects = (await readJson(projectsPath(), [])) as StoredProject[];
  const project = {
    ...projectFromPath(path),
    name: input.name || basename(path) || path,
  };
  await writeJson(projectsPath(), [
    project,
    ...projects.filter((item) => item.id !== project.id),
  ]);
  return project;
}

async function removeProject(projectId: string) {
  const projects = (await readJson(projectsPath(), [])) as StoredProject[];
  await writeJson(
    projectsPath(),
    projects.filter((project) => project.id !== projectId),
  );
  return true;
}

async function requireProject(projectId: string, defaultCwd: string) {
  const project = (await listProjects(defaultCwd)).find(
    (item) => item.id === projectId,
  );
  if (!project) throw new Error("Project not found");
  return project;
}

function projectFromPath(path: string): StoredProject {
  return {
    id: Buffer.from(path).toString("base64url"),
    name: basename(path) || path,
    path,
    createdAt: new Date().toISOString(),
  };
}

async function workspacesFor(project: StoredProject) {
  const workspaces = [
    {
      id: "root",
      projectId: project.id,
      path: project.path,
      label: basename(project.path) || project.path,
      isMain: true,
      isGitRepo: existsSync(join(project.path, ".git")),
      isGitWorktree: false,
    },
  ];
  const result = await runCommand(
    "git",
    ["-C", project.path, "worktree", "list", "--porcelain"],
    project.path,
    5000,
  ).catch(() => ({ output: "" }));
  for (const match of result.output.matchAll(/^worktree (.+)$/gm)) {
    const path = match[1];
    if (path !== project.path)
      workspaces.push({
        id: Buffer.from(path).toString("base64url"),
        projectId: project.id,
        path,
        label: basename(path),
        isMain: false,
        isGitRepo: true,
        isGitWorktree: true,
      });
  }
  return workspaces;
}

async function directorySuggestions(q: string) {
  const base =
    q.startsWith("/") || q.startsWith("~") ? dirname(expandHome(q)) : homedir();
  const needle = basename(q).toLowerCase();
  const entries = existsSync(base)
    ? await readdir(base, { withFileTypes: true })
    : [];
  return {
    directories: entries
      .filter(
        (entry) =>
          entry.isDirectory() && entry.name.toLowerCase().includes(needle),
      )
      .slice(0, 20)
      .map((entry) => join(base, entry.name)),
  };
}

export async function listSuggestions(
  cwd: string,
  query: string,
  pathsOnly: boolean,
) {
  const dir = query.includes("/") ? resolveInside(cwd, dirname(query)) : cwd;
  const needle = basename(query).toLowerCase();
  const entries = existsSync(dir)
    ? await readdir(dir, { withFileTypes: true })
    : [];
  const files = entries
    .filter((entry) => entry.name.toLowerCase().includes(needle))
    .slice(0, 50)
    .map((entry) => ({
      path: relative(cwd, join(dir, entry.name)),
      name: entry.name,
      type: entry.isDirectory() ? "directory" : "file",
    }));
  return pathsOnly ? { paths: files.map((file) => file.path) } : { files };
}

async function gitStatus(cwd: string) {
  const result = await runCommand(
    "git",
    ["-C", cwd, "status", "--short", "--branch"],
    cwd,
    8000,
  );
  if (result.output.includes("ENOENT")) {
    return {
      available: false,
      clean: false,
      message: "Git executable was not found in this environment.",
      output: result.output,
      files: [],
    };
  }
  const lines = result.output.split("\n").filter(Boolean);
  const files = lines.filter((line) => !line.startsWith("## "));
  return {
    available: result.code === 0,
    clean: result.code === 0 && files.length === 0,
    branch: lines.find((line) => line.startsWith("## ")) ?? "",
    output: result.output,
    files,
  };
}

async function gitDiff(cwd: string, path?: string, staged?: boolean) {
  const args = [
    "-C",
    cwd,
    "diff",
    ...(staged ? ["--staged"] : []),
    ...(path ? ["--", path] : []),
  ];
  const result = await runCommand("git", args, cwd, 8000);
  return { diff: result.output };
}
