import {
  CheckCircledIcon,
  Cross2Icon,
  CrossCircledIcon,
  ExclamationTriangleIcon,
  InfoCircledIcon,
} from "@radix-ui/react-icons";
import { Callout } from "@radix-ui/themes";
import { Button } from "./ui";
import type { noticeTone } from "./uiText";

type NoticeTone = ReturnType<typeof noticeTone>;

function NoticeIcon({ tone }: { tone: NoticeTone }) {
  if (tone === "warning") return <ExclamationTriangleIcon />;
  if (tone === "danger") return <CrossCircledIcon />;
  if (tone === "ok") return <CheckCircledIcon />;
  return <InfoCircledIcon />;
}

export function AppNotice({
  message,
  tone,
  onDismiss,
  onOpenDiagnostics,
}: {
  message: string;
  tone: NoticeTone;
  onDismiss: () => void;
  onOpenDiagnostics: () => void;
}) {
  const color =
    tone === "danger"
      ? "red"
      : tone === "warning"
        ? "orange"
        : tone === "ok"
          ? "green"
          : "blue";
  return (
    <Callout.Root
      className={`notice ${tone}`}
      color={color}
      role={tone === "danger" ? "alert" : "status"}
    >
      <Callout.Icon>
        <NoticeIcon tone={tone} />
      </Callout.Icon>
      <Callout.Text>{message}</Callout.Text>
      {message.includes("Diagnostics") && (
        <Button type="button" onClick={onOpenDiagnostics}>
          Open diagnostics
        </Button>
      )}
      <Button
        type="button"
        aria-label="Dismiss notification"
        onClick={onDismiss}
      >
        <Cross2Icon />
      </Button>
    </Callout.Root>
  );
}
