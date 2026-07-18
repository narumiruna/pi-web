// biome-ignore-all lint: compatibility deps wrap dynamic pi SDK objects.
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

export type Json = Record<string, unknown>;

export type CompatDeps = {
  defaultCwd: string;
  modelRuntime: ModelRuntime;
  listSessions: () => Promise<any[]>;
  resolveSessionPath: (id: string) => Promise<string | undefined>;
  getLiveSession: (id: string) => Promise<any>;
  startSession: (
    cwd: string,
    sessionFile?: string,
    toolNames?: string[],
  ) => Promise<any>;
  liveSessions: Map<string, any>;
};
