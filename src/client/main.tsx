// biome-ignore-all lint: Pi SDK/websocket wire data is dynamic in this MVP.
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import { ControlRoom } from "./ControlRoom";
import "./styles.css";

type SessionInfo = {
  id: string;
  path?: string;
  cwd: string;
  name?: string;
  created: string;
  modified: string;
  messageCount: number;
  firstMessage: string;
};

type ModelInfo = {
  provider: string;
  id: string;
  name?: string;
  contextWindow?: number;
};
type ToolInfo = { name: string; description?: string; active: boolean };
type FileEntry = { name: string; path: string; type: "file" | "directory" };
type AttachedImage = { data: string; mimeType: string; previewUrl: string };
type Tab = "chat" | "terminal" | "file" | "settings";

const THINKING = ["off", "minimal", "low", "medium", "high", "xhigh"];
const BUILTIN_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls"];

function textFromContent(content: any): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (part?.type === "text") return part.text ?? "";
      if (part?.type === "thinking")
        return part.thinking ? `\n[thinking]\n${part.thinking}\n` : "";
      if (part?.type === "toolCall")
        return `\n[tool: ${part.name ?? part.toolName}] ${JSON.stringify(part.arguments ?? part.input ?? {})}\n`;
      if (part?.type === "image") return "\n[image]\n";
      return "";
    })
    .join("");
}

function imagesFromContent(
  content: any,
): Array<{ data: string; mimeType: string }> {
  if (!Array.isArray(content)) return [];
  return content.flatMap((part) => {
    if (part?.type !== "image") return [];
    if (typeof part.data === "string" && typeof part.mimeType === "string")
      return [{ data: part.data, mimeType: part.mimeType }];
    const source = part.source;
    if (source?.type === "base64" && typeof source.data === "string")
      return [{ data: source.data, mimeType: source.mediaType ?? "image/png" }];
    return [];
  });
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? res.statusText);
  return json as T;
}

function App() {
  const [defaultCwd, setDefaultCwd] = useState<string>("");
  const [cwd, setCwd] = useState<string>("");
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [selected, setSelected] = useState<SessionInfo | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [streamText, setStreamText] = useState("");
  const [streamThinking, setStreamThinking] = useState("");
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<any>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [commands, setCommands] = useState<any[]>([]);
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState<Tab>("chat");
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [filePath, setFilePath] = useState("");
  const [file, setFile] = useState<any>(null);
  const eventsRef = useRef<EventSource | null>(null);

  const selectedId = selected?.id;
  const activeCwd = selected?.cwd || cwd || defaultCwd;

  const loadSessions = useCallback(async () => {
    const data = await api<{ sessions: SessionInfo[] }>("/api/sessions");
    setSessions(data.sessions);
  }, []);

  const loadMessages = useCallback(
    async (id = selectedId) => {
      if (!id) return;
      const data = await api<{ messages: any[] }>(
        `/api/sessions/${id}/messages`,
      );
      setMessages(data.messages);
    },
    [selectedId],
  );

  const loadTools = useCallback(
    async (id = selectedId) => {
      if (!id) return;
      const data = await api<{ tools: ToolInfo[] }>(
        `/api/sessions/${id}/tools`,
      );
      setTools(data.tools);
    },
    [selectedId],
  );

  const loadCommands = useCallback(
    async (id = selectedId) => {
      if (!id) return;
      const data = await api<{ commands: any[] }>(
        `/api/sessions/${id}/commands`,
      );
      setCommands(data.commands);
    },
    [selectedId],
  );

  const loadStatus = useCallback(
    async (id = selectedId) => {
      if (!id) return;
      const data = await api<{ running: boolean; status: any }>(
        `/api/sessions/${id}/status`,
      );
      setStatus(data.status);
      setRunning(Boolean(data.status?.isStreaming));
    },
    [selectedId],
  );

  const connectEvents = useCallback(
    (id: string) => {
      eventsRef.current?.close();
      const es = new EventSource(`/api/sessions/${id}/events`);
      eventsRef.current = es;
      es.onmessage = (message) => {
        const event = JSON.parse(message.data);
        if (event.type === "connected") {
          setStatus(event.status);
          setRunning(Boolean(event.status?.isStreaming));
        } else if (event.type === "status") {
          setStatus(event.status);
          setRunning(Boolean(event.status?.isStreaming));
        } else if (event.type === "agent_start") {
          setRunning(true);
          setStreamText("");
          setStreamThinking("");
        } else if (event.type === "message_update") {
          const delta = event.assistantMessageEvent;
          if (delta?.type === "text_delta")
            setStreamText((value) => value + delta.delta);
          if (delta?.type === "thinking_delta")
            setStreamThinking((value) => value + delta.delta);
        } else if (event.type === "tool_execution_start") {
          setMessages((value) => [
            ...value,
            {
              role: "toolResult",
              toolName: event.toolName,
              toolCallId: event.toolCallId,
              content: [{ type: "text", text: `Running ${event.toolName}...` }],
            },
          ]);
        } else if (event.type === "tool_execution_update") {
          const text =
            event.partialResult?.content
              ?.map((c: any) => c.text ?? "")
              .join("") ?? "";
          setMessages((value) =>
            value.map((msg) =>
              msg.toolCallId === event.toolCallId
                ? { ...msg, content: [{ type: "text", text }] }
                : msg,
            ),
          );
        } else if (event.type === "tool_execution_end") {
          const text =
            event.result?.content?.map((c: any) => c.text ?? "").join("") ?? "";
          setMessages((value) =>
            value.map((msg) =>
              msg.toolCallId === event.toolCallId
                ? {
                    ...msg,
                    isError: event.isError,
                    content: [{ type: "text", text }],
                  }
                : msg,
            ),
          );
        } else if (event.type === "agent_end" || event.type === "prompt_done") {
          setRunning(false);
          setStreamText("");
          setStreamThinking("");
          void loadMessages(id);
          void loadSessions();
          void loadStatus(id);
        } else if (event.type === "session_error") {
          setNotice(event.message);
          setRunning(false);
        } else if (event.type === "extension_ui" && event.method === "notify") {
          setNotice(event.message);
        }
      };
      es.onerror = () => setNotice("Event stream disconnected");
    },
    [loadMessages, loadSessions, loadStatus],
  );

  useEffect(() => {
    void api<{ defaultCwd: string }>("/api/config").then((config) => {
      setDefaultCwd(config.defaultCwd);
      setCwd(config.defaultCwd);
    });
    void loadSessions();
    void api<{ models: ModelInfo[] }>("/api/models")
      .then((data) => setModels(data.models))
      .catch((error) => setNotice(error.message));
    return () => eventsRef.current?.close();
  }, [loadSessions]);

  useEffect(() => {
    if (!selected) return;
    setCwd(selected.cwd);
    setTab("chat");
    void loadMessages(selected.id);
    void loadStatus(selected.id);
    void loadTools(selected.id);
    void loadCommands(selected.id);
    connectEvents(selected.id);
  }, [
    selected,
    loadMessages,
    loadStatus,
    loadTools,
    loadCommands,
    connectEvents,
  ]);

  useEffect(() => {
    if (!activeCwd) return;
    void api<{ entries: FileEntry[] }>(
      `/api/files/tree?cwd=${encodeURIComponent(activeCwd)}&path=${encodeURIComponent(filePath)}`,
    )
      .then((data) => setFiles(data.entries))
      .catch((error) => setNotice(error.message));
  }, [activeCwd, filePath]);

  async function newSession() {
    const data = await api<{ session: SessionInfo; status: any }>(
      "/api/sessions",
      {
        method: "POST",
        body: JSON.stringify({ cwd }),
      },
    );
    setSelected(data.session);
    setStatus(data.status);
    await loadSessions();
  }

  async function ensureSession(): Promise<SessionInfo> {
    if (selected) return selected;
    const data = await api<{ session: SessionInfo; status: any }>(
      "/api/sessions",
      {
        method: "POST",
        body: JSON.stringify({ cwd }),
      },
    );
    setSelected(data.session);
    setStatus(data.status);
    connectEvents(data.session.id);
    await loadSessions();
    return data.session;
  }

  async function sendPrompt(
    text: string,
    images?: AttachedImage[],
    streamingBehavior?: "steer" | "followUp",
  ) {
    const session = await ensureSession();
    if (!streamingBehavior)
      setMessages((value) => [
        ...value,
        {
          role: "user",
          content: images?.length
            ? [
                { type: "text", text },
                ...images.map((image) => ({
                  type: "image",
                  data: image.data,
                  mimeType: image.mimeType,
                })),
              ]
            : text,
        },
      ]);
    setRunning(true);
    await api(`/api/sessions/${session.id}/prompt`, {
      method: "POST",
      body: JSON.stringify({ text, images, streamingBehavior }),
    });
  }

  async function openFile(entry: FileEntry) {
    if (entry.type === "directory") {
      setFilePath(entry.path);
      return;
    }
    const data = await api<any>(
      `/api/files/content?cwd=${encodeURIComponent(activeCwd)}&path=${encodeURIComponent(entry.path)}`,
    );
    setFile(data);
    setTab("file");
  }

  async function saveTools(next: string[]) {
    if (!selectedId) return;
    await api(`/api/sessions/${selectedId}/tools`, {
      method: "POST",
      body: JSON.stringify({ toolNames: next }),
    });
    await loadTools(selectedId);
  }

  async function setModel(value: string) {
    if (!selectedId || !value) return;
    const [provider, ...rest] = value.split("/");
    await api(`/api/sessions/${selectedId}/model`, {
      method: "POST",
      body: JSON.stringify({ provider, modelId: rest.join("/") }),
    });
    await loadStatus(selectedId);
  }

  async function setThinking(level: string) {
    if (!selectedId) return;
    await api(`/api/sessions/${selectedId}/thinking`, {
      method: "POST",
      body: JSON.stringify({ level }),
    });
    await loadStatus(selectedId);
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">π web</div>
        <label className="field-label">cwd</label>
        <input
          className="input"
          value={cwd}
          onChange={(event) => setCwd(event.target.value)}
        />
        <button className="primary" onClick={() => void newSession()}>
          New session
        </button>
        <section className="panel grow">
          <div className="panel-title">Sessions</div>
          <div className="session-list">
            {sessions.map((session) => (
              <button
                key={session.id}
                className={`session ${selected?.id === session.id ? "active" : ""}`}
                onClick={() => setSelected(session)}
              >
                <span>
                  {session.name || session.firstMessage || "Untitled"}
                </span>
                <small>{session.cwd}</small>
              </button>
            ))}
          </div>
        </section>
        <section className="panel files">
          <div className="panel-title">
            Files
            {filePath && (
              <button
                className="link"
                onClick={() =>
                  setFilePath(filePath.split("/").slice(0, -1).join("/"))
                }
              >
                up
              </button>
            )}
          </div>
          <div className="file-list">
            {files.map((entry) => (
              <button
                key={entry.path}
                className="file-row"
                onClick={() => void openFile(entry)}
              >
                <span>{entry.type === "directory" ? "▸" : "•"}</span>{" "}
                {entry.name}
              </button>
            ))}
          </div>
        </section>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="tabs">
            <button
              className={tab === "chat" ? "active" : ""}
              onClick={() => setTab("chat")}
            >
              Chat
            </button>
            <button
              className={tab === "terminal" ? "active" : ""}
              onClick={() => setTab("terminal")}
            >
              Terminal
            </button>
            <button
              className={tab === "settings" ? "active" : ""}
              onClick={() => setTab("settings")}
            >
              Control room
            </button>
            {file && (
              <button
                className={tab === "file" ? "active" : ""}
                onClick={() => setTab("file")}
              >
                File
              </button>
            )}
          </div>
          <div className="statusline">
            {status?.model
              ? `${status.model.provider}/${status.model.id}`
              : "auto model"}
            {running ? " · running" : " · idle"}
          </div>
        </header>
        {notice && (
          <div className="notice" onClick={() => setNotice("")}>
            {notice}
          </div>
        )}
        {tab === "chat" && (
          <ChatPane
            messages={messages}
            streamText={streamText}
            streamThinking={streamThinking}
            running={running}
            onSend={sendPrompt}
            onAbort={async () =>
              selectedId &&
              api(`/api/sessions/${selectedId}/abort`, {
                method: "POST",
                body: "{}",
              }).then(() => setRunning(false))
            }
            onCompact={async () =>
              selectedId &&
              api(`/api/sessions/${selectedId}/compact`, {
                method: "POST",
                body: "{}",
              }).then(() => loadMessages(selectedId))
            }
            status={status}
            models={models}
            onModel={setModel}
            onThinking={setThinking}
            tools={tools}
            onTools={saveTools}
            commands={commands}
          />
        )}
        {tab === "terminal" && <TerminalPane cwd={activeCwd} />}
        {tab === "settings" && (
          <ControlRoom
            cwd={activeCwd}
            selected={selected}
            onNotice={setNotice}
            onSessionsChanged={async () => {
              await loadSessions();
              setSelected(null);
            }}
          />
        )}
        {tab === "file" && <FilePane file={file} />}
      </main>
    </div>
  );
}

function ChatPane(props: {
  messages: any[];
  streamText: string;
  streamThinking: string;
  running: boolean;
  onSend: (
    text: string,
    images?: AttachedImage[],
    streamingBehavior?: "steer" | "followUp",
  ) => Promise<void>;
  onAbort: () => Promise<unknown> | undefined;
  onCompact: () => Promise<unknown> | undefined;
  status: any;
  models: ModelInfo[];
  onModel: (value: string) => Promise<void>;
  onThinking: (level: string) => Promise<void>;
  tools: ToolInfo[];
  onTools: (tools: string[]) => Promise<void>;
  commands: any[];
}) {
  const endRef = useRef<HTMLDivElement | null>(null);
  useEffect(
    () => endRef.current?.scrollIntoView({ block: "end" }),
    [props.messages, props.streamText],
  );
  const activeToolNames = useMemo(
    () => props.tools.filter((tool) => tool.active).map((tool) => tool.name),
    [props.tools],
  );

  return (
    <div className="chat-tab">
      <div className="controls">
        <select
          value={
            props.status?.model
              ? `${props.status.model.provider}/${props.status.model.id}`
              : ""
          }
          onChange={(event) => void props.onModel(event.target.value)}
        >
          <option value="">auto model</option>
          {props.models.map((model) => (
            <option
              key={`${model.provider}/${model.id}`}
              value={`${model.provider}/${model.id}`}
            >
              {model.name || model.id} · {model.provider}
            </option>
          ))}
        </select>
        <select
          value={props.status?.thinkingLevel || "off"}
          onChange={(event) => void props.onThinking(event.target.value)}
        >
          {THINKING.map((level) => (
            <option key={level}>{level}</option>
          ))}
        </select>
        <button onClick={() => void props.onCompact()}>Compact</button>
        {props.running && (
          <button className="danger" onClick={() => void props.onAbort()}>
            Abort
          </button>
        )}
        <details className="tools-menu">
          <summary>Tools ({activeToolNames.length})</summary>
          <div className="tools-list">
            {props.tools.map((tool) => (
              <label key={tool.name} title={tool.description}>
                <input
                  type="checkbox"
                  checked={tool.active}
                  onChange={(event) => {
                    const next = new Set(activeToolNames);
                    if (event.target.checked) next.add(tool.name);
                    else next.delete(tool.name);
                    void props.onTools([...next]);
                  }}
                />
                {tool.name}
              </label>
            ))}
            {props.tools.length === 0 && (
              <small>No session tools loaded yet.</small>
            )}
          </div>
        </details>
      </div>
      <div className="messages">
        {props.messages.map((message, index) => (
          <Message key={index} message={message} />
        ))}
        {(props.streamThinking || props.streamText) && (
          <div className="message assistant streaming">
            {props.streamThinking && (
              <details open>
                <summary>thinking</summary>
                <pre>{props.streamThinking}</pre>
              </details>
            )}
            <pre>{props.streamText}</pre>
          </div>
        )}
        <div ref={endRef} />
      </div>
      <Composer
        running={props.running}
        commands={props.commands}
        onSend={props.onSend}
      />
    </div>
  );
}

function Message({ message }: { message: any }) {
  const role = message.role ?? "event";
  const images = imagesFromContent(message.content);
  return (
    <div className={`message ${role}`}>
      <div className="role">
        {role}
        {message.toolName ? ` · ${message.toolName}` : ""}
      </div>
      {images.map((image, index) => (
        <img
          key={index}
          className="inline-image"
          src={`data:${image.mimeType};base64,${image.data}`}
          alt="attached"
        />
      ))}
      <pre>{textFromContent(message.content)}</pre>
    </div>
  );
}

function Composer({
  running,
  commands,
  onSend,
}: {
  running: boolean;
  commands: any[];
  onSend: (
    text: string,
    images?: AttachedImage[],
    streamingBehavior?: "steer" | "followUp",
  ) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [images, setImages] = useState<AttachedImage[]>([]);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const slashCommands = commands.filter(
    (cmd) => text.startsWith("/") && cmd.name?.includes(text.slice(1)),
  );

  async function attach(files: FileList | File[]) {
    const imageFiles = [...files].filter((file) =>
      file.type.startsWith("image/"),
    );
    const next = await Promise.all(
      imageFiles.map(
        (file) =>
          new Promise<AttachedImage>((resolve) => {
            const reader = new FileReader();
            reader.onload = () =>
              resolve({
                data: String(reader.result).split(",")[1] ?? "",
                mimeType: file.type,
                previewUrl: URL.createObjectURL(file),
              });
            reader.readAsDataURL(file);
          }),
      ),
    );
    setImages((value) => [...value, ...next]);
  }

  async function submit(mode?: "steer" | "followUp") {
    if (!text.trim() && images.length === 0) return;
    await onSend(text, images, mode);
    setText("");
    setImages([]);
  }

  return (
    <div
      className="composer"
      onPaste={(event) => {
        const files = [
          ...new Map(
            [
              ...event.clipboardData.files,
              ...[...event.clipboardData.items].map((item) => item.getAsFile()),
            ]
              .filter((file): file is File => Boolean(file))
              .map((file) => [
                `${file.name}:${file.size}:${file.type}:${file.lastModified}`,
                file,
              ]),
          ).values(),
        ];
        if (!files.some((file) => file.type.startsWith("image/"))) return;
        event.preventDefault();
        void attach(files);
      }}
    >
      {images.length > 0 && (
        <div className="attachments">
          {images.map((image, index) => (
            <img key={index} src={image.previewUrl} alt="preview" />
          ))}
        </div>
      )}
      {slashCommands.length > 0 && (
        <div className="slash-menu">
          {slashCommands.slice(0, 8).map((cmd) => (
            <button key={cmd.name} onClick={() => setText(`/${cmd.name} `)}>
              /{cmd.name}
              <small>{cmd.description}</small>
            </button>
          ))}
        </div>
      )}
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void submit(running ? "steer" : undefined);
          }
        }}
        placeholder={
          running
            ? "Steer the running agent, or queue a follow-up…"
            : "Message pi… paste images or type /"
        }
      />
      <div className="composer-actions">
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(event) =>
            event.target.files && void attach(event.target.files)
          }
        />
        <button onClick={() => fileInput.current?.click()}>Image</button>
        {running && (
          <button onClick={() => void submit("followUp")}>Follow-up</button>
        )}
        <button
          className="primary"
          onClick={() => void submit(running ? "steer" : undefined)}
        >
          {running ? "Steer" : "Send"}
        </button>
      </div>
    </div>
  );
}

function TerminalPane({ cwd }: { cwd: string }) {
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

function FilePane({ file }: { file: any }) {
  if (!file) return <div className="empty">Open a file from the sidebar.</div>;
  if (file.binary)
    return (
      <div className="empty">
        Binary file: {file.path} ({file.size} bytes)
      </div>
    );
  return (
    <div className="file-pane">
      <div className="file-title">{file.path}</div>
      {file.image ? (
        <img
          className="file-image"
          src={`data:${file.mimeType};base64,${file.content}`}
          alt={file.path}
        />
      ) : (
        <pre>{file.content}</pre>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
