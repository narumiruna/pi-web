// biome-ignore-all lint: compatibility routes intentionally accept third-party wire shapes.
import { resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { runCommand } from "./compatShared.js";
import type { CompatDeps as Deps } from "./compatTypes.js";

export function registerFileCompatRoutes(app: FastifyInstance, _deps: Deps) {
  app.get<{ Params: { projectId: string; workspaceId: string } }>(
    "/api/projects/:projectId/workspaces/:workspaceId/git/status",
    async (request) =>
      gitStatus(
        workspaceRoot(request.params.projectId, request.params.workspaceId),
      ),
  );
}

function workspaceRoot(projectId: string, workspaceId: string) {
  return resolve(
    Buffer.from(
      workspaceId === "root" ? projectId : workspaceId,
      "base64url",
    ).toString("utf8"),
  );
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
