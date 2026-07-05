// biome-ignore-all lint: terminal focus and websocket wire data are intentionally small here.
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef, useState } from "react";
import {
  type CommandSnippet,
  hasSecretLikeText,
  parseSnippets,
  trimTerminalBuffer,
} from "./terminalHelpers";

const SNIPPETS_KEY = "pi-web.terminal-snippets";

function draft(text: string) {
  window.dispatchEvent(new CustomEvent("pi-web:draft", { detail: text }));
}

export function TerminalPane({ cwd }: { cwd: string }) {
  const terminalRef = useRef<HTMLDivElement | null>(null);
  const terminal = useRef<Terminal | null>(null);
  const ws = useRef<WebSocket | null>(null);
  const buffer = useRef<string[]>([]);
  const [snippets, setSnippets] = useState<CommandSnippet[]>(() =>
    parseSnippets(localStorage.getItem(SNIPPETS_KEY)),
  );
  const [snippetName, setSnippetName] = useState("");
  const [snippetCommand, setSnippetCommand] = useState("");

  function rememberSnippet() {
    if (!snippetName.trim() || !snippetCommand.trim()) return;
    const next = [
      ...snippets.filter((item) => item.name !== snippetName.trim()),
      { name: snippetName.trim(), command: snippetCommand },
    ];
    setSnippets(next);
    localStorage.setItem(SNIPPETS_KEY, JSON.stringify(next));
    setSnippetName("");
    setSnippetCommand("");
  }

  function sendTextToChat(text: string) {
    if (!text.trim()) return;
    if (
      hasSecretLikeText(text) &&
      !confirm("Terminal output may contain a secret. Send anyway?")
    )
      return;
    draft(`Terminal output from ${cwd}:\n\n${text}`);
  }

  function sendToChat(lines = 80) {
    sendTextToChat(buffer.current.slice(-lines).join("\n"));
  }

  function sendSelectionToChat() {
    sendTextToChat(terminal.current?.getSelection() ?? "");
  }

  function run(command: string) {
    ws.current?.send(JSON.stringify({ type: "input", data: `${command}\r` }));
  }

  useEffect(() => {
    const host = terminalRef.current;
    if (!host) return;

    let disposed = false;
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      fontSize: 13,
      scrollback: 5000,
      theme: { background: "#05070c", foreground: "#d1fae5" },
    });
    terminal.current = term;
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.attachCustomKeyEventHandler((event) => {
      if (
        event.type === "keydown" &&
        (event.ctrlKey || event.metaKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "l"
      ) {
        sendToChat(80);
        return false;
      }
      return true;
    });
    term.open(host);

    const protocol = location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(
      `${protocol}://${location.host}/api/terminal?cwd=${encodeURIComponent(cwd)}`,
    );
    ws.current = socket;
    const sendResize = () => {
      fitAddon.fit();
      if (socket.readyState === WebSocket.OPEN)
        socket.send(
          JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }),
        );
    };

    const input = term.onData((data) => {
      if (socket.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify({ type: "input", data }));
    });
    const resizeObserver = new ResizeObserver(sendResize);
    resizeObserver.observe(host);

    socket.onopen = () => {
      sendResize();
      term.focus();
    };
    socket.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "data") {
        term.write(msg.data);
        buffer.current = trimTerminalBuffer([
          ...buffer.current,
          ...String(msg.data).split(/\r?\n/),
        ]);
      }
      if (msg.type === "exit")
        term.write(`\r\n[process exited ${msg.code}]\r\n`);
    };
    socket.onclose = () => {
      if (!disposed) term.write("\r\n[terminal disconnected]\r\n");
    };

    return () => {
      disposed = true;
      resizeObserver.disconnect();
      input.dispose();
      socket.close();
      term.dispose();
      ws.current = null;
      terminal.current = null;
    };
  }, [cwd]);

  return (
    <div className="terminal-tab">
      <div className="terminal-toolbar">
        <button
          type="button"
          title="Ctrl/⌘ Shift L"
          onClick={() => sendToChat(80)}
        >
          Send last 80 lines to chat
        </button>
        <button type="button" onClick={sendSelectionToChat}>
          Send selection to chat
        </button>
        <input
          className="input"
          value={snippetName}
          onChange={(event) => setSnippetName(event.target.value)}
          placeholder="Snippet name"
        />
        <input
          className="input"
          value={snippetCommand}
          onChange={(event) => setSnippetCommand(event.target.value)}
          placeholder="Command"
        />
        <button type="button" onClick={rememberSnippet}>
          Save snippet
        </button>
        {snippets.map((snippet) => (
          <button
            type="button"
            key={snippet.name}
            onClick={() => run(snippet.command)}
          >
            {snippet.name}
          </button>
        ))}
      </div>
      <div aria-label="Terminal" className="terminal-shell" ref={terminalRef} />
    </div>
  );
}
