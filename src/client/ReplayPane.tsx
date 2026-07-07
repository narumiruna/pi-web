import { useState } from "react";

type ReplayPart = { text?: string; thinking?: string; type?: string };
type ReplayMessage = {
  id?: string;
  role?: string;
  content?: string | ReplayPart[];
};

function textFromContent(content: ReplayMessage["content"]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return JSON.stringify(content ?? "");
  return content
    .map((part) => part.text ?? part.thinking ?? `[${part.type ?? "part"}]`)
    .join("\n");
}

export function ReplayPane() {
  const [messages, setMessages] = useState<ReplayMessage[]>([]);

  async function load(file: File) {
    const json = JSON.parse(await file.text()) as {
      messages?: ReplayMessage[];
    };
    setMessages(Array.isArray(json.messages) ? json.messages : []);
  }

  return (
    <div className="tool-pane replay-pane">
      <section className="panel">
        <div className="section-head">
          <div>
            <div className="panel-title">Session replay</div>
            <h2>Read-only export replay</h2>
            <p>
              Load an exported session JSON file to inspect messages and tool
              calls.
            </p>
          </div>
          <input
            type="file"
            accept="application/json,.json"
            onChange={(event) =>
              event.target.files?.[0] && void load(event.target.files[0])
            }
          />
        </div>
      </section>
      <section className="messages replay-messages">
        {messages.map((message) => (
          <article
            className="message"
            key={
              message.id ??
              `${message.role ?? "event"}-${textFromContent(message.content).slice(0, 80)}`
            }
          >
            <div className="role">{message.role ?? "event"}</div>
            <pre>{textFromContent(message.content)}</pre>
          </article>
        ))}
        {messages.length === 0 && (
          <div className="empty-small">No replay loaded.</div>
        )}
      </section>
    </div>
  );
}
