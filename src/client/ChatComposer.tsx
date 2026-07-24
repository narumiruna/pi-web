import { ImageIcon, PaperPlaneIcon, PlusIcon } from "@radix-ui/react-icons";
import { ScrollArea } from "@radix-ui/themes";
import { useEffect, useRef, useState } from "react";
import { createSingleFlight } from "./asyncState";
import { createAttachmentId } from "./attachmentIds";
import { getPastedImageFiles } from "./clipboardImages";
import { appendDraftText, type ComposerIntent } from "./composerIntents";
import { clearSubmittedImages, clearSubmittedText } from "./composerState";
import type { AttachedImage } from "./types";
import { Button, TextArea } from "./ui";

type ComposerCommand = {
  name?: string;
  description?: string;
};

type SendMessage = (
  text: string,
  images?: AttachedImage[],
  streamingBehavior?: "steer" | "followUp",
) => Promise<void>;

export function EmptyState({
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
        <span className="eyebrow">New conversation</span>
        <h2>{hasSession ? "Ready when you are" : "What are we building?"}</h2>
        <p>
          {hasSession
            ? "Describe the outcome you want, or choose a starting point."
            : "Send a message below to create a chat in this workspace."}
        </p>
        <section className="quick-actions" aria-label="Starting points">
          {actions.map(([label, prompt]) => (
            <Button
              type="button"
              key={label}
              disabled={running}
              onClick={() => void onSend(prompt)}
            >
              {label}
            </Button>
          ))}
        </section>
      </section>
    </div>
  );
}

export function ChatComposer({
  running,
  commands,
  composerIntents,
  onComposerIntentsConsumed,
  onSend,
}: {
  running: boolean;
  commands: ComposerCommand[];
  composerIntents: ComposerIntent[];
  onComposerIntentsConsumed?: (ids: number[]) => void;
  onSend: SendMessage;
}) {
  const [text, setText] = useState("");
  const [images, setImages] = useState<AttachedImage[]>([]);
  const textInput = useRef<HTMLTextAreaElement | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const submitFlight = useRef(createSingleFlight<void>()).current;
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
                id: createAttachmentId(),
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
    await submitFlight.run(async () => {
      const submittedText = text;
      const submittedImages = images;
      if (!submittedText.trim() && submittedImages.length === 0) return;
      try {
        await onSend(submittedText, submittedImages, mode);
        setText((value) => clearSubmittedText(value, submittedText));
        setImages((value) => clearSubmittedImages(value, submittedImages));
      } catch {
        // Keep the draft; the parent surfaces the request error.
      } finally {
        textInput.current?.focus();
      }
    });
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
      <div className="composer-inner">
        {images.length > 0 && (
          <div className="attachments">
            {images.map((image) => (
              <img key={image.id} src={image.previewUrl} alt="preview" />
            ))}
          </div>
        )}
        {slashCommands.length > 0 && (
          <ScrollArea className="slash-menu" type="auto">
            {slashCommands.slice(0, 8).map((cmd) => (
              <Button
                type="button"
                key={cmd.name}
                onClick={() => setText(`/${cmd.name} `)}
              >
                /{cmd.name}
                <small>{cmd.description}</small>
              </Button>
            ))}
          </ScrollArea>
        )}
        <TextArea
          ref={textInput}
          value={text}
          aria-label="Message pi"
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
        <div className="composer-footer">
          <span className="composer-hint">
            Enter to send · Shift Enter for newline
          </span>
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
            <Button type="button" onClick={() => fileInput.current?.click()}>
              <ImageIcon />
              Add image
            </Button>
            {running && (
              <Button type="button" onClick={() => void submit("followUp")}>
                <PlusIcon />
                Follow-up
              </Button>
            )}
            <Button
              type="button"
              className="primary"
              onClick={() => void submit(running ? "steer" : undefined)}
            >
              <PaperPlaneIcon />
              {running ? "Steer" : "Send"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
