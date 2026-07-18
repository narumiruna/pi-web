import type { AttachedImage } from "./types";

export const COMPOSER_DRAFT_EVENT = "pi-web:draft";
export const COMPOSER_ATTACH_IMAGE_EVENT = "pi-web:attach-image";
export const COMPOSER_FOCUS_EVENT = "pi-web:focus-prompt";

export type ComposerIntent =
  | { id: number; type: "draft"; text: string }
  | { id: number; type: "attachImage"; image: AttachedImage }
  | { id: number; type: "focus" };

export function appendDraftText(current: string, text: string): string {
  return `${current}${current ? "\n\n" : ""}${text}`;
}

function isAttachedImage(value: unknown): value is AttachedImage {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as AttachedImage).id === "string" &&
    typeof (value as AttachedImage).data === "string" &&
    typeof (value as AttachedImage).mimeType === "string" &&
    typeof (value as AttachedImage).previewUrl === "string"
  );
}

export function composerIntentFromEvent(
  id: number,
  event: Event,
): ComposerIntent | undefined {
  if (event.type === COMPOSER_FOCUS_EVENT) return { id, type: "focus" };
  if (event.type === COMPOSER_DRAFT_EVENT) {
    const detail = (event as CustomEvent<unknown>).detail;
    return typeof detail === "string"
      ? { id, type: "draft", text: detail }
      : undefined;
  }
  if (event.type === COMPOSER_ATTACH_IMAGE_EVENT) {
    const detail = (event as CustomEvent<unknown>).detail;
    return isAttachedImage(detail)
      ? { id, type: "attachImage", image: detail }
      : undefined;
  }
  return undefined;
}
