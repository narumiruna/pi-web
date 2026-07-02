// biome-ignore-all lint: Pi SDK wire data is dynamic in this MVP.
import { useEffect, useMemo, useRef, useState } from "react";
import { getPastedImageFiles } from "./clipboardImages";
import type { AttachedImage, ModelInfo, ToolInfo } from "./types";
import { nextStepFor, noticeTone, scopeLabel, toolRiskLabel } from "./uiText";

const THINKING = ["off", "minimal", "low", "medium", "high", "xhigh"];

function textFromContent(content: any): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (part?.type === "text") return part.text ?? "";
      if (part?.type === "thinking") return part.thinking ?? "";
      if (part?.type === "toolCall")
        return `${part.name ?? part.toolName ?? "tool"} ${JSON.stringify(part.arguments ?? part.input ?? {})}`;
      return "";
    })
    .join("\n");
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

export function ChatPane(props: {
  messages: any[];
  streamText: string;
  streamThinking: string;
  running: boolean;
  hasSession: boolean;
  cwd: string;
  onOpenTerminal: () => void;
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
  const empty = props.messages.length === 0 && !props.streamText;

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
          <summary>
            Tools ({activeToolNames.length}/{props.tools.length})
          </summary>
          <div className="tools-list">
            {props.tools.map((tool) => {
              const active = activeToolNames.includes(tool.name);
              const risk = toolRiskLabel(tool.name);
              return (
                <label key={tool.name} title={tool.description}>
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={(event) => {
                      const next = new Set(activeToolNames);
                      if (event.target.checked) next.add(tool.name);
                      else next.delete(tool.name);
                      void props.onTools([...next]);
                    }}
                  />
                  <span>
                    <strong>{tool.name}</strong>
                    <span className="tool-description">
                      {tool.description || "No description"}
                    </span>
                    <span className="tool-labels">
                      <span
                        className={`state-badge ${active ? "ok" : "muted"}`}
                      >
                        {active ? "enabled" : "disabled"}
                      </span>
                      <span className="scope-badge">
                        {scopeLabel(tool.sourceInfo?.scope)} scope
                      </span>
                      {risk && <span className="risk-badge">{risk}</span>}
                    </span>
                  </span>
                </label>
              );
            })}
            {props.tools.length === 0 && (
              <small>Select a session to load session-scoped tools.</small>
            )}
          </div>
        </details>
      </div>
      {empty ? (
        <EmptyState
          hasSession={props.hasSession}
          cwd={props.cwd}
          running={props.running}
          onOpenTerminal={props.onOpenTerminal}
          onSend={props.onSend}
        />
      ) : (
        <div className="messages">
          {props.messages.map((message, index) => (
            <Message key={index} message={message} />
          ))}
          {(props.streamThinking || props.streamText) && (
            <div className="message assistant streaming">
              {props.streamThinking && (
                <details className="reasoning-summary">
                  <summary>Reasoning summary</summary>
                  <pre>{props.streamThinking}</pre>
                </details>
              )}
              <pre>{props.streamText}</pre>
            </div>
          )}
          <div ref={endRef} />
        </div>
      )}
      <Composer
        running={props.running}
        commands={props.commands}
        onSend={props.onSend}
      />
    </div>
  );
}

function EmptyState({
  hasSession,
  cwd,
  running,
  onOpenTerminal,
  onSend,
}: {
  hasSession: boolean;
  cwd: string;
  running: boolean;
  onOpenTerminal: () => void;
  onSend: (text: string) => Promise<void>;
}) {
  const actions = [
    [
      "Inspect repo",
      "Inspect this repository and summarize its structure, entry points, and test commands.",
    ],
    [
      "Run tests",
      "Find and run the smallest relevant test command for this repository, then summarize the result.",
    ],
    [
      "Explain project",
      "Explain what this project does, where the main code lives, and how to start it.",
    ],
    [
      "Create new task",
      "Help me turn my next coding task into a short implementation checklist for this repository.",
    ],
  ] as const;

  return (
    <div className="messages empty-state">
      <section className="empty-card">
        <div className="eyebrow">{cwd || "workspace"}</div>
        <h2>{hasSession ? "New session ready" : "No active session"}</h2>
        <p>
          {hasSession
            ? "Ask pi to inspect the workspace, run a check, or explain the project."
            : "Start by selecting a session or asking the agent to inspect the workspace."}
        </p>
        <div className="quick-actions">
          {actions.map(([label, prompt]) => (
            <button
              type="button"
              key={label}
              disabled={running}
              onClick={() => void onSend(prompt)}
            >
              {label}
            </button>
          ))}
          <button type="button" onClick={onOpenTerminal}>
            Open terminal
          </button>
        </div>
      </section>
    </div>
  );
}

function Message({ message }: { message: any }) {
  const role = message.role ?? "event";
  const text = textFromContent(message.content);
  const tone = message.isError ? "danger" : noticeTone(text);
  const toneClass = tone === "info" ? "" : tone;
  const nextStep = nextStepFor(text);
  const images = imagesFromContent(message.content);
  return (
    <div className={`message ${role} ${toneClass}`}>
      <div className="role">
        {role === "toolResult" ? "Tool result" : role}
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
      {role === "toolResult" ? (
        <div className={`tool-card result ${toneClass}`}>
          <div className="tool-card-title">
            {message.isError ? "Error" : "Result"}
          </div>
          <pre>{text}</pre>
        </div>
      ) : (
        <MessageContent content={message.content} />
      )}
      {nextStep && <div className="next-step">{nextStep}</div>}
    </div>
  );
}

function MessageContent({ content }: { content: any }) {
  if (typeof content === "string") return <pre>{content}</pre>;
  if (!Array.isArray(content)) return null;
  return (
    <>
      {content.map((part, index) => {
        if (part?.type === "text" && part.text)
          return <pre key={index}>{part.text}</pre>;
        if (part?.type === "thinking" && part.thinking)
          return (
            <details key={index} className="reasoning-summary">
              <summary>Reasoning summary</summary>
              <pre>{part.thinking}</pre>
            </details>
          );
        if (part?.type === "toolCall") {
          const name = part.name ?? part.toolName ?? "tool";
          const args = part.arguments ?? part.input ?? {};
          return (
            <div key={index} className="tool-card call">
              <div className="tool-card-title">Action · {name}</div>
              <pre>{JSON.stringify(args, null, 2)}</pre>
            </div>
          );
        }
        return null;
      })}
    </>
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
        const files = getPastedImageFiles(event.clipboardData);
        if (files.length === 0) return;
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
