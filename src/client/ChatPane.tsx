// biome-ignore-all lint: Pi SDK wire data is dynamic in this MVP.
import { useEffect, useMemo, useRef, useState } from "react";
import { getPastedImageFiles } from "./clipboardImages";
import type { AttachedImage, ModelInfo, ToolInfo } from "./types";

const THINKING = ["off", "minimal", "low", "medium", "high", "xhigh"];

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

export function ChatPane(props: {
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
