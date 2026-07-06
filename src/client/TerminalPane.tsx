// biome-ignore-all lint: terminal focus and websocket wire data are intentionally small here.
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef } from "react";

const terminalThemes = {
  light: {
    background: "#ffffff",
    foreground: "#1f2328",
    cursor: "#2563eb",
    selectionBackground: "#dbeafe",
    black: "#1f2328",
    brightBlack: "#6e7781",
    blue: "#2563eb",
    brightBlue: "#60a5fa",
    cyan: "#0891b2",
    green: "#16a34a",
    magenta: "#7c3aed",
    red: "#ef4444",
    yellow: "#ea580c",
  },
  dark: {
    background: "#111827",
    foreground: "#f2f4f7",
    cursor: "#60a5fa",
    selectionBackground: "#1e3a8a",
    black: "#0f172a",
    brightBlack: "#98a2b3",
    blue: "#60a5fa",
    brightBlue: "#93c5fd",
    cyan: "#22d3ee",
    green: "#4ade80",
    magenta: "#a78bfa",
    red: "#f87171",
    yellow: "#fb923c",
  },
} as const;

export function TerminalPane({
  cwd,
  theme = "light",
}: {
  cwd: string;
  theme?: keyof typeof terminalThemes;
}) {
  const terminalRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = terminalRef.current;
    if (!host) return;

    let disposed = false;
    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      fontSize: 13,
      scrollback: 5000,
      theme: terminalThemes[theme],
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(host);

    const protocol = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(
      `${protocol}://${location.host}/api/terminal?cwd=${encodeURIComponent(cwd)}`,
    );
    const sendResize = () => {
      fitAddon.fit();
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: "resize",
            cols: terminal.cols,
            rows: terminal.rows,
          }),
        );
      }
    };

    const input = terminal.onData((data) => {
      if (ws.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ type: "input", data }));
    });
    const resizeObserver = new ResizeObserver(sendResize);
    resizeObserver.observe(host);

    ws.onopen = () => {
      sendResize();
      terminal.focus();
    };
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "data") terminal.write(msg.data);
      if (msg.type === "exit")
        terminal.write(`\r\n[process exited ${msg.code}]\r\n`);
    };
    ws.onclose = () => {
      if (!disposed) terminal.write("\r\n[terminal disconnected]\r\n");
    };

    return () => {
      disposed = true;
      resizeObserver.disconnect();
      input.dispose();
      ws.close();
      terminal.dispose();
    };
  }, [cwd, theme]);

  return (
    <section className="terminal-tab terminal-panel" aria-label="Terminal">
      <header className="terminal-header">
        <div className="terminal-heading">
          <div className="panel-title">Local shell</div>
          <div className="terminal-cwd" title={cwd || "workspace"}>
            {cwd || "workspace"}
          </div>
        </div>
        <div className="terminal-status">
          <span className="status-dot ok" aria-hidden="true" />
          connected
        </div>
      </header>
      <div className="terminal-frame">
        <div className="terminal-shell" ref={terminalRef} />
      </div>
    </section>
  );
}
