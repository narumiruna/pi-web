// biome-ignore-all lint: terminal focus and websocket wire data are intentionally small here.
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef } from "react";

export function TerminalPane({ cwd }: { cwd: string }) {
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
      theme: {
        background: "#05070c",
        foreground: "#d1fae5",
      },
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
  }, [cwd]);

  return (
    <div
      aria-label="Terminal"
      className="terminal-tab terminal-shell"
      ref={terminalRef}
    />
  );
}
