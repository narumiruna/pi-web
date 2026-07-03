// biome-ignore-all lint: terminal focus and websocket wire data are intentionally small here.
import { useEffect, useRef, useState } from "react";

export const MAX_TERMINAL_OUTPUT_CHARS = 120_000;
const TRIMMED_TERMINAL_MARKER = "[trimmed older terminal output]\n";

export function appendTerminalOutput(
  current: string,
  chunk: string,
  maxChars = MAX_TERMINAL_OUTPUT_CHARS,
): string {
  const next = current + chunk;
  if (next.length <= maxChars) return next;
  if (maxChars <= TRIMMED_TERMINAL_MARKER.length) return next.slice(-maxChars);
  const keep = maxChars - TRIMMED_TERMINAL_MARKER.length;
  const tail = next.slice(-keep);
  const lineStart = tail.indexOf("\n");
  return `${TRIMMED_TERMINAL_MARKER}${lineStart >= 0 ? tail.slice(lineStart + 1) : tail}`;
}

export function TerminalPane({ cwd }: { cwd: string }) {
  const [output, setOutput] = useState("");
  const [input, setInput] = useState("");
  const wsRef = useRef<WebSocket | null>(null);
  const outputRef = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(
      `${protocol}://${location.host}/api/terminal?cwd=${encodeURIComponent(cwd)}`,
    );
    wsRef.current = ws;
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "data")
        setOutput((value) => appendTerminalOutput(value, msg.data));
      if (msg.type === "exit")
        setOutput((value) =>
          appendTerminalOutput(value, `\n[process exited ${msg.code}]\n`),
        );
    };
    return () => ws.close();
  }, [cwd]);

  useEffect(() => {
    const outputEl = outputRef.current;
    if (outputEl) outputEl.scrollTop = outputEl.scrollHeight;
  }, [output]);

  function send() {
    wsRef.current?.send(JSON.stringify({ type: "input", data: `${input}\n` }));
    setOutput((value) => appendTerminalOutput(value, `$ ${input}\n`));
    setInput("");
  }

  return (
    <div className="terminal-tab">
      <pre className="terminal-output" ref={outputRef}>
        {output}
      </pre>
      <div className="terminal-input">
        <span>$</span>
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") send();
          }}
          autoFocus
        />
        <button onClick={send}>Run</button>
      </div>
    </div>
  );
}
