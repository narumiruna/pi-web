// biome-ignore-all lint: terminal focus and websocket wire data are intentionally small here.
import { CodeIcon, PaperPlaneIcon } from "@radix-ui/react-icons";
import { Popover } from "@radix-ui/themes";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef, useState } from "react";
import { COMPOSER_DRAFT_EVENT } from "./composerIntents";
import {
  type CommandSnippet,
  hasSecretLikeText,
  parseSnippets,
  trimTerminalBuffer,
} from "./terminalHelpers";
import { Button, TextInput } from "./ui";

const SNIPPETS_KEY = "pi-web.terminal-snippets";

function draft(text: string) {
  window.dispatchEvent(new CustomEvent(COMPOSER_DRAFT_EVENT, { detail: text }));
}

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
      theme: terminalThemes[theme],
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
        <div className="terminal-header-actions">
          <div className="terminal-status" role="status">
            <span className="status-dot ok" aria-hidden="true" />
            connected
          </div>
          <Button
            type="button"
            title="Send recent output to chat · Ctrl/⌘ Shift L"
            onClick={() => sendToChat(80)}
          >
            <PaperPlaneIcon />
            Send recent output
          </Button>
          <Button type="button" onClick={sendSelectionToChat}>
            <PaperPlaneIcon />
            Send selection
          </Button>
          <Popover.Root>
            <Popover.Trigger>
              <Button type="button" className="terminal-snippets-trigger">
                <CodeIcon />
                Snippets{snippets.length ? ` · ${snippets.length}` : ""}
              </Button>
            </Popover.Trigger>
            <Popover.Content
              className="terminal-snippets-menu"
              align="end"
              sideOffset={8}
            >
              <div className="terminal-snippet-form">
                <div className="terminal-snippet-field">
                  <span>Name</span>
                  <TextInput
                    className="input"
                    aria-label="Snippet name"
                    value={snippetName}
                    onChange={(event) => setSnippetName(event.target.value)}
                    placeholder="e.g. test"
                  />
                </div>
                <div className="terminal-snippet-field">
                  <span>Command</span>
                  <TextInput
                    className="input"
                    aria-label="Snippet command"
                    value={snippetCommand}
                    onChange={(event) => setSnippetCommand(event.target.value)}
                    placeholder="npm test"
                  />
                </div>
                <Button type="button" onClick={rememberSnippet}>
                  Save snippet
                </Button>
              </div>
              {snippets.length > 0 && (
                <div
                  className="terminal-saved-snippets"
                  aria-label="Saved snippets"
                >
                  {snippets.map((snippet) => (
                    <Button
                      type="button"
                      key={snippet.name}
                      title={snippet.command}
                      onClick={() => run(snippet.command)}
                    >
                      <span>{snippet.name}</span>
                      <code>{snippet.command}</code>
                    </Button>
                  ))}
                </div>
              )}
            </Popover.Content>
          </Popover.Root>
        </div>
      </header>
      <div className="terminal-frame">
        <div className="terminal-shell" ref={terminalRef} />
      </div>
    </section>
  );
}
