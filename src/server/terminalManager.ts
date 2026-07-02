import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

type Handler = {
  output: (data: string, replay: boolean) => void;
  exit: (code: number | undefined) => void;
};

type Terminal = {
  id: string;
  cwd: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  process: ChildProcessWithoutNullStreams;
  buffer: string[];
  exitCode?: number;
  handlers: Set<Handler>;
};

export type TerminalCommandRun = {
  id: string;
  title: string;
  command: string;
  cwd: string;
  status: "running" | "completed" | "failed" | "cancelled";
  output: string;
  exitCode?: number;
  startedAt: string;
  finishedAt?: string;
  metadata?: Record<string, string>;
};

export class TerminalManager {
  private terminals = new Map<string, Terminal>();
  private runs = new Map<
    string,
    TerminalCommandRun & { child?: ChildProcessWithoutNullStreams }
  >();

  list(cwd: string) {
    return [...this.terminals.values()]
      .filter((terminal) => terminal.cwd === cwd)
      .map((terminal) => this.info(terminal));
  }

  create(options: { cwd: string; name?: string }) {
    const id = randomUUID();
    const shell = process.env.PI_WEB_SHELL || "/bin/sh";
    const child = spawn(shell, [], {
      cwd: options.cwd,
      env: { ...process.env, TERM: "xterm-256color" },
      stdio: "pipe",
    });
    const terminal: Terminal = {
      id,
      cwd: options.cwd,
      name: options.name || `Terminal ${this.terminals.size + 1}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      process: child,
      buffer: [`$ ${shell} (${options.cwd})\n`],
      handlers: new Set(),
    };
    const push = (data: string) => {
      terminal.updatedAt = new Date().toISOString();
      terminal.buffer.push(data);
      if (terminal.buffer.length > 800)
        terminal.buffer.splice(0, terminal.buffer.length - 800);
      for (const handler of terminal.handlers) handler.output(data, false);
    };
    child.stdout.on("data", (chunk) => push(chunk.toString()));
    child.stderr.on("data", (chunk) => push(chunk.toString()));
    child.on("close", (code) => {
      terminal.exitCode = code ?? undefined;
      for (const handler of terminal.handlers) handler.exit(terminal.exitCode);
    });
    this.terminals.set(id, terminal);
    return this.info(terminal);
  }

  ensure(cwd: string) {
    return this.list(cwd)[0] ?? this.create({ cwd });
  }

  closeForCwd(cwd: string) {
    for (const terminal of this.terminals.values()) {
      if (terminal.cwd === cwd) this.close(terminal.id);
    }
  }

  close(id: string) {
    const terminal = this.require(id);
    terminal.process.kill();
    this.terminals.delete(id);
  }

  continue(id: string) {
    return this.info(this.require(id));
  }

  attach(id: string, handler: Handler) {
    const terminal = this.require(id);
    terminal.handlers.add(handler);
    for (const chunk of terminal.buffer) handler.output(chunk, true);
    if (terminal.exitCode !== undefined) handler.exit(terminal.exitCode);
    return () => terminal.handlers.delete(handler);
  }

  write(id: string, data: string) {
    this.require(id).process.stdin.write(data);
  }

  resize(_id: string, _cols: number, _rows: number) {
    // node:child_process shells do not expose pty resizing; route kept for API parity.
  }

  runCommand(options: {
    cwd: string;
    title?: string;
    command: string;
    metadata?: Record<string, string>;
  }): TerminalCommandRun {
    const id = randomUUID();
    const run: TerminalCommandRun & { child?: ChildProcessWithoutNullStreams } =
      {
        id,
        title: options.title || options.command,
        command: options.command,
        cwd: options.cwd,
        status: "running",
        output: "",
        startedAt: new Date().toISOString(),
        metadata: options.metadata,
      };
    const child = spawn(
      process.env.PI_WEB_SHELL || "/bin/sh",
      ["-lc", options.command],
      {
        cwd: options.cwd,
        env: { ...process.env, TERM: "xterm-256color" },
        stdio: "pipe",
      },
    );
    run.child = child;
    child.stdout.on("data", (chunk) => (run.output += chunk.toString()));
    child.stderr.on("data", (chunk) => (run.output += chunk.toString()));
    child.on("close", (code) => {
      run.exitCode = code ?? undefined;
      run.status =
        run.status === "cancelled"
          ? "cancelled"
          : code === 0
            ? "completed"
            : "failed";
      run.finishedAt = new Date().toISOString();
      delete run.child;
    });
    this.runs.set(id, run);
    return this.publicRun(run);
  }

  listCommandRuns(filter: { cwd?: string; status?: string } = {}) {
    return [...this.runs.values()]
      .filter((run) => !filter.cwd || run.cwd === filter.cwd)
      .filter((run) => !filter.status || run.status === filter.status)
      .map((run) => this.publicRun(run));
  }

  getCommandRun(id: string) {
    const run = this.runs.get(id);
    return run ? this.publicRun(run) : undefined;
  }

  cancelCommandRun(id: string) {
    const run = this.runs.get(id);
    if (!run) throw new Error("Terminal command run not found");
    if (run.status === "running") {
      run.status = "cancelled";
      run.finishedAt = new Date().toISOString();
      run.child?.kill();
    }
    return this.publicRun(run);
  }

  private require(id: string) {
    const terminal = this.terminals.get(id);
    if (!terminal) throw new Error("Terminal not found");
    return terminal;
  }

  private info(terminal: Terminal) {
    return {
      id: terminal.id,
      cwd: terminal.cwd,
      name: terminal.name,
      createdAt: terminal.createdAt,
      updatedAt: terminal.updatedAt,
      exitCode: terminal.exitCode,
    };
  }

  private publicRun(
    run: TerminalCommandRun & { child?: ChildProcessWithoutNullStreams },
  ): TerminalCommandRun {
    const { child: _child, ...value } = run;
    return value;
  }
}
