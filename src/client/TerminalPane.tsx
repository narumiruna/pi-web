// biome-ignore-all lint: terminal focus and websocket wire data are intentionally small here.
import { useEffect, useRef, useState } from "react";

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
      if (msg.type === "data") setOutput((value) => value + msg.data);
      if (msg.type === "exit")
        setOutput((value) => value + `\n[process exited ${msg.code}]\n`);
    };
    return () => ws.close();
  }, [cwd]);

  useEffect(() => {
    const outputEl = outputRef.current;
    if (outputEl) outputEl.scrollTop = outputEl.scrollHeight;
  }, [output]);

  function send() {
    wsRef.current?.send(JSON.stringify({ type: "input", data: `${input}\n` }));
    setOutput((value) => value + `$ ${input}\n`);
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
