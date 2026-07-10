// biome-ignore-all lint: Pi SDK wire data is dynamic in this MVP.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildAgentTimeline, type ValidationSummary } from "./agentTimeline";
import { api } from "./api";
import { getPastedImageFiles } from "./clipboardImages";
import {
  appendDraftText,
  COMPOSER_DRAFT_EVENT,
  type ComposerIntent,
} from "./composerIntents";
import { linkifyText } from "./textLinks";
import type { AttachedImage, ModelInfo, ToolInfo } from "./types";
import {
  nextStepFor,
  noticeTone,
  scopeLabel,
  toolResultDisclosure,
  toolRiskLabel,
} from "./uiText";
import {
  parseWorkspaceImageMarkdown,
  workspaceImageUrl,
} from "./workspaceImages";

const THINKING = ["off", "minimal", "low", "medium", "high", "xhigh"];

function contentHash(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1)
    hash = Math.imul(31, hash) + value.charCodeAt(index);
  return (hash >>> 0).toString(36);
}

function safeJson(value: unknown) {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

export function messageKey(message: any, index = 0): string {
  const stableId =
    message.id ??
    message.entryId ??
    message.messageId ??
    message.toolCallId ??
    message.createdAt ??
    message.timestamp;
  if (stableId) return `${message.role ?? "event"}:${stableId}`;
  const fallback =
    textFromContent(message.content) ||
    safeJson(message.content ?? message) ||
    "empty";
  return `${message.role ?? "event"}:${contentHash(fallback)}:${index}`;
}

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

export type DisplayMessageGroup = {
  kind: "message" | "activity";
  indexes: number[];
  hasError: boolean;
};

function isTechnicalMessage(message: any): boolean {
  if (message?.role === "toolResult") return true;
  if (message?.role !== "assistant" || !Array.isArray(message.content))
    return false;
  return (
    message.content.length > 0 &&
    message.content.every(
      (part: any) => part?.type === "thinking" || part?.type === "toolCall",
    )
  );
}

export function groupMessagesForDisplay(
  messages: any[],
): DisplayMessageGroup[] {
  const groups: DisplayMessageGroup[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    if (!isTechnicalMessage(messages[index])) {
      groups.push({ kind: "message", indexes: [index], hasError: false });
      continue;
    }

    let routineIndexes: number[] = [];
    const flushRoutineActivity = () => {
      if (routineIndexes.length === 0) return;
      groups.push({
        kind: "activity",
        indexes: routineIndexes,
        hasError: false,
      });
      routineIndexes = [];
    };
    while (index < messages.length && isTechnicalMessage(messages[index])) {
      const technicalMessage = messages[index];
      const failed =
        technicalMessage.role === "toolResult" &&
        toolResultDisclosure({
          isError: technicalMessage.isError,
          text: textFromContent(technicalMessage.content),
        }).open;
      if (failed) {
        flushRoutineActivity();
        groups.push({ kind: "activity", indexes: [index], hasError: true });
      } else {
        routineIndexes.push(index);
      }
      index += 1;
    }
    flushRoutineActivity();
    index -= 1;
  }
  return groups;
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
  sessionId?: string;
  cwd: string;
  onOpenDiff: () => void;
  onOpenValidation: () => void;
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
  composerIntents?: ComposerIntent[];
  onComposerIntentsConsumed?: (ids: number[]) => void;
  lastValidation?: ValidationSummary | null;
  locateMessage?: number | null;
  onLocated?: () => void;
}) {
  const endRef = useRef<HTMLDivElement | null>(null);
  useEffect(
    () => endRef.current?.scrollIntoView({ block: "end" }),
    [props.messages, props.streamText, props.streamThinking],
  );
  const { locateMessage, onLocated } = props;
  useEffect(() => {
    if (locateMessage === null || locateMessage === undefined) return;
    if (props.messages.length <= locateMessage) return;
    const target = document.querySelector(
      `[data-message-index="${locateMessage}"]`,
    );
    if (!target) return;
    target.scrollIntoView({ block: "center" });
    target.classList.add("located");
    window.setTimeout(() => target.classList.remove("located"), 2400);
    onLocated?.();
  }, [locateMessage, onLocated, props.messages]);
  const activeToolNames = useMemo(
    () => props.tools.filter((tool) => tool.active).map((tool) => tool.name),
    [props.tools],
  );
  const empty =
    props.messages.length === 0 && !props.streamText && !props.streamThinking;
  const timeline = buildAgentTimeline(
    props.messages,
    props.running,
    props.lastValidation,
  );
  const currentActivity =
    timeline.find((item) => item.state === "running") ??
    [...timeline]
      .reverse()
      .find((item) => item.state === "done" || item.state === "failed") ??
    timeline[0];
  const sessionId = props.sessionId;
  const [bookmarked, setBookmarked] = useState<Set<number>>(new Set());
  useEffect(() => {
    if (!sessionId) {
      setBookmarked(new Set());
      return;
    }
    void api<{ bookmarks: any[] }>("/api/bookmarks")
      .then((data) =>
        setBookmarked(
          new Set(
            data.bookmarks
              .filter((item) => item.sessionId === sessionId)
              .map((item) => Number(item.messageIndex))
              .filter(Number.isInteger),
          ),
        ),
      )
      .catch(() => undefined);
  }, [sessionId]);
  const toggleBookmark = useCallback(
    async (messageIndex: number, role: string, excerpt: string) => {
      if (!sessionId) return;
      const remove = bookmarked.has(messageIndex);
      await api("/api/bookmarks", {
        method: "POST",
        body: JSON.stringify({
          sessionId,
          messageIndex,
          role,
          excerpt,
          remove,
        }),
      });
      setBookmarked((prev) => {
        const next = new Set(prev);
        if (remove) next.delete(messageIndex);
        else next.add(messageIndex);
        return next;
      });
    },
    [sessionId, bookmarked],
  );

  return (
    <div className="chat-tab">
      {props.hasSession && (
        <div className="session-bar">
          <div className="session-context" title={props.cwd}>
            <span>
              {props.cwd.split("/").filter(Boolean).pop() || "Workspace"}
            </span>
          </div>
          <details
            className="session-options"
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.currentTarget.open = false;
              event.currentTarget
                .querySelector<HTMLElement>("summary")
                ?.focus();
            }}
          >
            <summary>Session options</summary>
            <div className="session-options-menu">
              <label>
                <span>Model</span>
                <select
                  aria-label="Model"
                  disabled={props.models.length === 0}
                  value={
                    props.status?.model
                      ? `${props.status.model.provider}/${props.status.model.id}`
                      : ""
                  }
                  onChange={(event) => void props.onModel(event.target.value)}
                >
                  <option value="">Automatic</option>
                  {props.models.map((model) => (
                    <option
                      key={`${model.provider}/${model.id}`}
                      value={`${model.provider}/${model.id}`}
                    >
                      {model.name || model.id} · {model.provider}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Reasoning</span>
                <select
                  aria-label="Reasoning"
                  value={props.status?.thinkingLevel || "off"}
                  onChange={(event) =>
                    void props.onThinking(event.target.value)
                  }
                >
                  {THINKING.map((level) => (
                    <option key={level}>{level}</option>
                  ))}
                </select>
              </label>
              <div className="session-option-actions">
                <button type="button" onClick={props.onOpenDiff}>
                  Review changes
                </button>
                <button type="button" onClick={props.onOpenValidation}>
                  Validate
                </button>
                <button type="button" onClick={() => void props.onCompact()}>
                  Compact conversation
                </button>
                {props.running && (
                  <button
                    type="button"
                    className="danger"
                    onClick={() => void props.onAbort()}
                  >
                    Stop agent
                  </button>
                )}
              </div>
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
                    <small>No tools are available for this chat.</small>
                  )}
                </div>
              </details>
            </div>
          </details>
        </div>
      )}
      {!empty && (
        <details
          className="activity-panel"
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.currentTarget.open = false;
            event.currentTarget.querySelector<HTMLElement>("summary")?.focus();
          }}
        >
          <summary>
            <strong>Activity</strong>
            <span>
              {currentActivity.phase}: {currentActivity.title}
            </span>
          </summary>
          <section
            className="agent-timeline"
            aria-label="Plan Act Verify timeline"
          >
            {timeline.map((item) =>
              item.phase === "Verify" ? (
                <button
                  type="button"
                  className={`timeline-item ${item.state}`}
                  key={item.phase}
                  title="Open validation panel"
                  onClick={props.onOpenValidation}
                >
                  <strong>{item.phase}</strong>
                  <span>{item.title}</span>
                  <small>{item.detail}</small>
                </button>
              ) : (
                <div className={`timeline-item ${item.state}`} key={item.phase}>
                  <strong>{item.phase}</strong>
                  <span>{item.title}</span>
                  <small>{item.detail}</small>
                </div>
              ),
            )}
          </section>
        </details>
      )}
      {empty ? (
        <EmptyState
          hasSession={props.hasSession}
          running={props.running}
          onSend={props.onSend}
        />
      ) : (
        <div className="messages">
          <MessageList
            messages={props.messages}
            cwd={props.cwd}
            sessionId={props.sessionId}
            bookmarked={bookmarked}
            onToggleBookmark={toggleBookmark}
          />
          <StreamingMessage
            text={props.streamText}
            thinking={props.streamThinking}
            cwd={props.cwd}
          />
          <div ref={endRef} />
        </div>
      )}
      <Composer
        running={props.running}
        commands={props.commands}
        composerIntents={props.composerIntents ?? []}
        onComposerIntentsConsumed={props.onComposerIntentsConsumed}
        onSend={props.onSend}
      />
    </div>
  );
}

function EmptyState({
  hasSession,
  running,
  onSend,
}: {
  hasSession: boolean;
  running: boolean;
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
  ] as const;

  return (
    <div className="messages empty-state">
      <section className="empty-card">
        <h2>{hasSession ? "Ready when you are" : "Start with a message"}</h2>
        <p>
          {hasSession
            ? "Describe the outcome you want, or choose a starting point."
            : "Describe what you want to change. A chat will be created automatically."}
        </p>
        <div className="quick-actions" aria-label="Starting points">
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
        </div>
      </section>
    </div>
  );
}

const MessageList = memo(function MessageList({
  messages,
  cwd,
  sessionId,
  bookmarked,
  onToggleBookmark,
}: {
  messages: any[];
  cwd: string;
  sessionId?: string;
  bookmarked: Set<number>;
  onToggleBookmark: (
    messageIndex: number,
    role: string,
    excerpt: string,
  ) => Promise<void>;
}) {
  return groupMessagesForDisplay(messages).map((group) =>
    group.kind === "activity" ? (
      <ToolActivityGroup
        key={`activity:${group.indexes.join(":")}`}
        messages={group.indexes.map((index) => ({
          message: messages[index],
          index,
        }))}
        hasError={group.hasError}
        cwd={cwd}
        sessionId={sessionId}
        bookmarked={bookmarked}
        onToggleBookmark={onToggleBookmark}
      />
    ) : (
      <Message
        key={messageKey(messages[group.indexes[0]], group.indexes[0])}
        message={messages[group.indexes[0]]}
        cwd={cwd}
        sessionId={sessionId}
        messageIndex={group.indexes[0]}
        bookmarked={bookmarked.has(group.indexes[0])}
        onToggleBookmark={onToggleBookmark}
      />
    ),
  );
});

function ToolActivityGroup({
  messages,
  hasError,
  cwd,
  sessionId,
  bookmarked,
  onToggleBookmark,
}: {
  messages: Array<{ message: any; index: number }>;
  hasError: boolean;
  cwd: string;
  sessionId?: string;
  bookmarked: Set<number>;
  onToggleBookmark: (
    messageIndex: number,
    role: string,
    excerpt: string,
  ) => Promise<void>;
}) {
  const [open, setOpen] = useState(hasError);
  return (
    <details
      className={`tool-activity-group ${hasError ? "danger" : ""}`}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        Agent activity · {messages.length} step
        {messages.length === 1 ? "" : "s"}
        {hasError ? " · Needs attention" : ""}
      </summary>
      <div className="tool-activity-items">
        {messages.map(({ message, index }) => (
          <Message
            key={messageKey(message, index)}
            message={message}
            cwd={cwd}
            sessionId={sessionId}
            messageIndex={index}
            bookmarked={bookmarked.has(index)}
            onToggleBookmark={onToggleBookmark}
          />
        ))}
      </div>
    </details>
  );
}

function draft(text: string) {
  window.dispatchEvent(new CustomEvent(COMPOSER_DRAFT_EVENT, { detail: text }));
}

const Message = memo(function Message({
  message,
  cwd,
  sessionId,
  messageIndex,
  bookmarked,
  onToggleBookmark,
}: {
  message: any;
  cwd: string;
  sessionId?: string;
  messageIndex: number;
  bookmarked: boolean;
  onToggleBookmark: (
    messageIndex: number,
    role: string,
    excerpt: string,
  ) => Promise<void>;
}) {
  const role = message.role ?? "event";
  const text = textFromContent(message.content);
  const bookmark = () =>
    sessionId && onToggleBookmark(messageIndex, role, text.slice(0, 180));
  const bookmarkLabel = bookmarked ? "Bookmarked ★" : "Bookmark";
  const tone = message.isError ? "danger" : noticeTone(text);
  const toneClass = tone === "info" ? "" : tone;
  const nextStep = nextStepFor(text);
  const images = imagesFromContent(message.content);
  const toolDisclosure = toolResultDisclosure({
    isError: message.isError,
    text,
  });
  const [toolResultOpen, setToolResultOpen] = useState(toolDisclosure.open);
  if (role === "toolResult") {
    return (
      <div
        className={`message ${role} ${toneClass}`}
        data-message-index={messageIndex}
      >
        <details
          className={`tool-card result ${toneClass}`}
          open={toolResultOpen}
          onToggle={(event) => setToolResultOpen(event.currentTarget.open)}
        >
          <summary>
            {toolDisclosure.label}
            {message.toolName ? ` · ${message.toolName}` : ""}
          </summary>
          {images.map((image, index) => (
            <img
              key={index}
              className="inline-image"
              src={`data:${image.mimeType};base64,${image.data}`}
              alt="attached"
            />
          ))}
          <WorkspaceText text={text} cwd={cwd} />
          <div className="row-actions">
            {message.isError && (
              <button
                type="button"
                onClick={() =>
                  draft(`Tool failed: ${message.toolName ?? "tool"}\n\n${text}`)
                }
              >
                Quote error
              </button>
            )}
            {sessionId && (
              <button type="button" onClick={() => void bookmark()}>
                {bookmarkLabel}
              </button>
            )}
          </div>
          {nextStep && <div className="next-step">{nextStep}</div>}
        </details>
      </div>
    );
  }
  return (
    <div
      className={`message ${role} ${toneClass}`}
      data-message-index={messageIndex}
    >
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
      <MessageContent content={message.content} cwd={cwd} />
      {sessionId && (
        <button type="button" className="link" onClick={() => void bookmark()}>
          {bookmarkLabel}
        </button>
      )}
      {nextStep && <div className="next-step">{nextStep}</div>}
    </div>
  );
});

const StreamingMessage = memo(function StreamingMessage({
  text,
  thinking,
  cwd,
}: {
  text: string;
  thinking: string;
  cwd: string;
}) {
  if (!thinking && !text) return null;
  return (
    <div className="message assistant streaming">
      {thinking && (
        <details className="reasoning-summary">
          <summary>Reasoning summary</summary>
          <WorkspaceText text={thinking} cwd={cwd} />
        </details>
      )}
      <WorkspaceText text={text} cwd={cwd} />
    </div>
  );
});

function LinkifiedText({ text }: { text: string }) {
  return linkifyText(text).map((part, index) =>
    part.type === "link" ? (
      <a key={index} href={part.href} target="_blank" rel="noopener noreferrer">
        {part.text}
      </a>
    ) : (
      <span key={index}>{part.text}</span>
    ),
  );
}

function WorkspaceText({ text, cwd }: { text: string; cwd: string }) {
  return (
    <>
      {parseWorkspaceImageMarkdown(text).map((part, index) =>
        part.type === "workspaceImage" ? (
          <img
            key={index}
            className="inline-image workspace-image"
            src={workspaceImageUrl(cwd, part.path)}
            alt={part.alt}
            loading="lazy"
          />
        ) : part.text ? (
          <pre key={index}>
            <LinkifiedText text={part.text} />
          </pre>
        ) : null,
      )}
    </>
  );
}

function MessageContent({ content, cwd }: { content: any; cwd: string }) {
  if (typeof content === "string")
    return <WorkspaceText text={content} cwd={cwd} />;
  if (!Array.isArray(content)) return null;
  const toolCalls = content
    .map((part, index) => ({ part, index }))
    .filter(({ part }) => part?.type === "toolCall");
  return (
    <>
      {content.map((part, index) => {
        if (part?.type === "text" && part.text)
          return <WorkspaceText key={index} text={part.text} cwd={cwd} />;
        if (part?.type === "thinking" && part.thinking)
          return (
            <details key={index} className="reasoning-summary">
              <summary>Reasoning summary</summary>
              <WorkspaceText text={part.thinking} cwd={cwd} />
            </details>
          );
        return null;
      })}
      {toolCalls.length > 0 && (
        <details className="agent-actions">
          <summary>
            Agent actions · {toolCalls.length} call
            {toolCalls.length === 1 ? "" : "s"}
          </summary>
          <div className="agent-action-items">
            {toolCalls.map(({ part, index }) => {
              const name = part.name ?? part.toolName ?? "tool";
              const args = part.arguments ?? part.input ?? {};
              return (
                <div key={index} className="tool-card call">
                  <div className="tool-card-title">{name}</div>
                  <pre>{JSON.stringify(args, null, 2)}</pre>
                </div>
              );
            })}
          </div>
        </details>
      )}
    </>
  );
}

function Composer({
  running,
  commands,
  composerIntents,
  onComposerIntentsConsumed,
  onSend,
}: {
  running: boolean;
  commands: any[];
  composerIntents: ComposerIntent[];
  onComposerIntentsConsumed?: (ids: number[]) => void;
  onSend: (
    text: string,
    images?: AttachedImage[],
    streamingBehavior?: "steer" | "followUp",
  ) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [images, setImages] = useState<AttachedImage[]>([]);
  const textInput = useRef<HTMLTextAreaElement | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const slashCommands = commands.filter(
    (cmd) => text.startsWith("/") && cmd.name?.includes(text.slice(1)),
  );

  useEffect(() => {
    if (composerIntents.length === 0) return;
    for (const intent of composerIntents) {
      if (intent.type === "draft")
        setText((value) => appendDraftText(value, intent.text));
      if (intent.type === "attachImage")
        setImages((value) => [...value, intent.image]);
    }
    textInput.current?.focus();
    onComposerIntentsConsumed?.(composerIntents.map((intent) => intent.id));
  }, [composerIntents, onComposerIntentsConsumed]);

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
    textInput.current?.focus();
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
        ref={textInput}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          const modEnter =
            event.key === "Enter" && (event.metaKey || event.ctrlKey);
          if (modEnter || (event.key === "Enter" && !event.shiftKey)) {
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
