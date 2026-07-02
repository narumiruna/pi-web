// biome-ignore-all lint: compatibility deps wrap dynamic pi SDK objects.
export type Json = Record<string, unknown>;

export type CompatDeps = {
  defaultCwd: string;
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

export type StoredProject = {
  id: string;
  name: string;
  path: string;
  createdAt: string;
};
