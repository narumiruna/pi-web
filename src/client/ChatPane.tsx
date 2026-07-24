// biome-ignore-all lint: Pi SDK wire data is dynamic in this MVP.
import {
  BookmarkFilledIcon,
  BookmarkIcon,
  CheckCircledIcon,
  ChevronDownIcon,
  CubeIcon,
  GearIcon,
  MixerHorizontalIcon,
  StopIcon,
} from "@radix-ui/react-icons";
import { Checkbox, Popover, ScrollArea } from "@radix-ui/themes";
import { Collapsible } from "radix-ui";
import type { ReactNode } from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildAgentTimeline, type ValidationSummary } from "./agentTimeline";
import { api } from "./api";
import { ChatComposer, EmptyState } from "./ChatComposer";
import { COMPOSER_DRAFT_EVENT, type ComposerIntent } from "./composerIntents";
import { linkifyText } from "./textLinks";
import type { AttachedImage, ModelInfo, ToolInfo } from "./types";
import { Button, SelectField } from "./ui";
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

function safeJson(value: unknown, space?: number) {
  try {
    return JSON.stringify(value, null, space) ?? "";
  } catch {
    return "";
  }
}

function Disclosure({
  className,
  open,
  onOpenChange,
  label,
  children,
}: {
  className: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <Collapsible.Root
      className={className}
      open={open}
      onOpenChange={onOpenChange}
    >
      <Collapsible.Trigger asChild>
        <Button type="button" className="disclosure-trigger">
          <span>{label}</span>
          <ChevronDownIcon className="disclosure-chevron" />
        </Button>
      </Collapsible.Trigger>
      <Collapsible.Content>{children}</Collapsible.Content>
    </Collapsible.Root>
  );
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

export function scopedMessageKey(
  sessionId: string | undefined,
  message: any,
  index = 0,
): string {
  return `${sessionId ?? "no-chat"}:${messageKey(message, index)}`;
}

export function revealDisclosure(open: boolean, urgent: boolean): boolean {
  return open || urgent;
}

function textFromContent(content: any): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (part?.type === "text") return part.text ?? "";
      if (part?.type === "thinking") return part.thinking ?? "";
      if (part?.type === "toolCall")
        return `${part.name ?? part.toolName ?? "tool"} ${safeJson(part.arguments ?? part.input ?? {})}`;
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
    let cancelled = false;
    if (!sessionId) {
      setBookmarked(new Set());
      return;
    }
    void api<{ bookmarks: any[] }>("/api/bookmarks")
      .then((data) => {
        if (cancelled) return;
        setBookmarked(
          new Set(
            data.bookmarks
              .filter((item) => item.sessionId === sessionId)
              .map((item) => Number(item.messageIndex))
              .filter(Number.isInteger),
          ),
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
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
            <CubeIcon />
            <span>
              {props.cwd.split("/").filter(Boolean).pop() || "Workspace"}
            </span>
          </div>
          <Popover.Root>
            <Popover.Trigger>
              <Button type="button" className="session-options-trigger">
                <GearIcon />
                Session options
                <ChevronDownIcon />
              </Button>
            </Popover.Trigger>
            <Popover.Content
              className="session-options-menu"
              align="end"
              sideOffset={8}
            >
              <label>
                <span>Model</span>
                <SelectField
                  ariaLabel="Model"
                  disabled={props.models.length === 0}
                  value={
                    props.status?.model
                      ? `${props.status.model.provider}/${props.status.model.id}`
                      : ""
                  }
                  onValueChange={(value) => void props.onModel(value)}
                  options={[
                    { value: "", label: "Automatic" },
                    ...props.models.map((model) => ({
                      value: `${model.provider}/${model.id}`,
                      label: `${model.name || model.id} · ${model.provider}`,
                    })),
                  ]}
                />
              </label>
              <label>
                <span>Reasoning</span>
                <SelectField
                  ariaLabel="Reasoning"
                  value={props.status?.thinkingLevel || "off"}
                  onValueChange={(value) => void props.onThinking(value)}
                  options={THINKING.map((level) => ({
                    value: level,
                    label: level,
                  }))}
                />
              </label>
              <div className="session-option-actions">
                <Button type="button" onClick={props.onOpenDiff}>
                  Review changes
                </Button>
                <Button type="button" onClick={props.onOpenValidation}>
                  <CheckCircledIcon />
                  Validate
                </Button>
                <Button type="button" onClick={() => void props.onCompact()}>
                  Compact conversation
                </Button>
                {props.running && (
                  <Button
                    type="button"
                    className="danger"
                    onClick={() => void props.onAbort()}
                  >
                    <StopIcon />
                    Stop agent
                  </Button>
                )}
              </div>
              <Collapsible.Root className="tools-menu">
                <Collapsible.Trigger asChild>
                  <Button type="button" className="tools-trigger">
                    <MixerHorizontalIcon />
                    Tools ({activeToolNames.length}/{props.tools.length})
                    <ChevronDownIcon className="disclosure-chevron" />
                  </Button>
                </Collapsible.Trigger>
                <Collapsible.Content>
                  <ScrollArea className="tools-list" type="auto">
                    {props.tools.map((tool) => {
                      const active = activeToolNames.includes(tool.name);
                      const risk = toolRiskLabel(tool.name);
                      return (
                        <label key={tool.name} title={tool.description}>
                          <Checkbox
                            checked={active}
                            onCheckedChange={(checked) => {
                              const next = new Set(activeToolNames);
                              if (checked === true) next.add(tool.name);
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
                              {risk && (
                                <span className="risk-badge">{risk}</span>
                              )}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                    {props.tools.length === 0 && (
                      <small>No tools are available for this chat.</small>
                    )}
                  </ScrollArea>
                </Collapsible.Content>
              </Collapsible.Root>
            </Popover.Content>
          </Popover.Root>
        </div>
      )}
      {!empty && (
        <Disclosure
          className="activity-panel"
          label={
            <>
              <strong>Activity</strong>
              <span>
                {currentActivity.phase}: {currentActivity.title}
              </span>
            </>
          }
        >
          <section
            className="agent-timeline"
            aria-label="Plan Act Verify timeline"
          >
            {timeline.map((item) =>
              item.phase === "Verify" ? (
                <Button
                  type="button"
                  className={`timeline-item ${item.state}`}
                  key={item.phase}
                  title="Open validation panel"
                  onClick={props.onOpenValidation}
                >
                  <strong>{item.phase}</strong>
                  <span>{item.title}</span>
                  <small>{item.detail}</small>
                </Button>
              ) : (
                <div className={`timeline-item ${item.state}`} key={item.phase}>
                  <strong>{item.phase}</strong>
                  <span>{item.title}</span>
                  <small>{item.detail}</small>
                </div>
              ),
            )}
          </section>
        </Disclosure>
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
      <ChatComposer
        running={props.running}
        commands={props.commands}
        composerIntents={props.composerIntents ?? []}
        onComposerIntentsConsumed={props.onComposerIntentsConsumed}
        onSend={props.onSend}
      />
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
        key={`${sessionId ?? "no-chat"}:activity:${group.indexes[0]}`}
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
        key={scopedMessageKey(
          sessionId,
          messages[group.indexes[0]],
          group.indexes[0],
        )}
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
  useEffect(() => {
    if (hasError) setOpen((value) => revealDisclosure(value, true));
  }, [hasError]);
  return (
    <Disclosure
      className={`tool-activity-group ${hasError ? "danger" : ""}`}
      open={open}
      onOpenChange={setOpen}
      label={
        <>
          Agent activity · {messages.length} step
          {messages.length === 1 ? "" : "s"}
          {hasError ? " · Needs attention" : ""}
        </>
      }
    >
      <div className="tool-activity-items">
        {messages.map(({ message, index }) => (
          <Message
            key={scopedMessageKey(sessionId, message, index)}
            message={message}
            cwd={cwd}
            sessionId={sessionId}
            messageIndex={index}
            bookmarked={bookmarked.has(index)}
            onToggleBookmark={onToggleBookmark}
          />
        ))}
      </div>
    </Disclosure>
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
  const bookmarkLabel = bookmarked ? "Bookmarked" : "Bookmark";
  const tone = message.isError ? "danger" : noticeTone(text);
  const toneClass = tone === "info" ? "" : tone;
  const nextStep = nextStepFor(text);
  const images = imagesFromContent(message.content);
  const toolDisclosure = toolResultDisclosure({
    isError: message.isError,
    text,
  });
  const [toolResultOpen, setToolResultOpen] = useState(toolDisclosure.open);
  useEffect(() => {
    if (toolDisclosure.open)
      setToolResultOpen((value) => revealDisclosure(value, true));
  }, [toolDisclosure.open]);
  if (role === "toolResult") {
    return (
      <div
        className={`message ${role} ${toneClass}`}
        data-message-index={messageIndex}
      >
        <Disclosure
          className={`tool-card result ${toneClass}`}
          open={toolResultOpen}
          onOpenChange={setToolResultOpen}
          label={
            <>
              {toolDisclosure.label}
              {message.toolName ? ` · ${message.toolName}` : ""}
            </>
          }
        >
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
              <Button
                type="button"
                onClick={() =>
                  draft(`Tool failed: ${message.toolName ?? "tool"}\n\n${text}`)
                }
              >
                Quote error
              </Button>
            )}
            {sessionId && (
              <Button type="button" onClick={() => void bookmark()}>
                {bookmarked ? <BookmarkFilledIcon /> : <BookmarkIcon />}
                {bookmarkLabel}
              </Button>
            )}
          </div>
          {nextStep && <div className="next-step">{nextStep}</div>}
        </Disclosure>
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
        <Button type="button" className="link" onClick={() => void bookmark()}>
          {bookmarked ? <BookmarkFilledIcon /> : <BookmarkIcon />}
          {bookmarkLabel}
        </Button>
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
        <Disclosure className="reasoning-summary" label="Reasoning summary">
          <WorkspaceText text={thinking} cwd={cwd} />
        </Disclosure>
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
            <Disclosure
              key={index}
              className="reasoning-summary"
              label="Reasoning summary"
            >
              <WorkspaceText text={part.thinking} cwd={cwd} />
            </Disclosure>
          );
        return null;
      })}
      {toolCalls.length > 0 && (
        <Disclosure
          className="agent-actions"
          label={
            <>
              Agent actions · {toolCalls.length} call
              {toolCalls.length === 1 ? "" : "s"}
            </>
          }
        >
          <div className="agent-action-items">
            {toolCalls.map(({ part, index }) => {
              const name = part.name ?? part.toolName ?? "tool";
              const args = part.arguments ?? part.input ?? {};
              return (
                <div key={index} className="tool-card call">
                  <div className="tool-card-title">{name}</div>
                  <pre>{safeJson(args, 2) || "[unserializable arguments]"}</pre>
                </div>
              );
            })}
          </div>
        </Disclosure>
      )}
    </>
  );
}
