import { describe, expect, it } from "vitest";
import {
  appendDraftText,
  COMPOSER_ATTACH_IMAGE_EVENT,
  COMPOSER_DRAFT_EVENT,
  COMPOSER_FOCUS_EVENT,
  composerIntentFromEvent,
} from "./composerIntents";
import type { AttachedImage } from "./types";

describe("composer intents", () => {
  it("appends draft text with the same separator the composer uses", () => {
    expect(appendDraftText("", "first")).toBe("first");
    expect(appendDraftText("first", "second")).toBe("first\n\nsecond");
  });

  it("turns global draft, image, and focus events into queued composer intents", () => {
    const image: AttachedImage = {
      id: "attachment-1",
      data: "abc",
      mimeType: "image/png",
      previewUrl: "blob:abc",
    };

    expect(
      composerIntentFromEvent(
        1,
        new CustomEvent(COMPOSER_DRAFT_EVENT, { detail: "quote" }),
      ),
    ).toEqual({ id: 1, type: "draft", text: "quote" });
    expect(
      composerIntentFromEvent(
        2,
        new CustomEvent(COMPOSER_ATTACH_IMAGE_EVENT, { detail: image }),
      ),
    ).toEqual({ id: 2, type: "attachImage", image });
    expect(composerIntentFromEvent(3, new Event(COMPOSER_FOCUS_EVENT))).toEqual(
      { id: 3, type: "focus" },
    );
  });

  it("ignores malformed composer events instead of queueing unusable drafts", () => {
    expect(
      composerIntentFromEvent(
        1,
        new CustomEvent(COMPOSER_DRAFT_EVENT, { detail: 42 }),
      ),
    ).toBeUndefined();
    expect(
      composerIntentFromEvent(
        2,
        new CustomEvent(COMPOSER_ATTACH_IMAGE_EVENT, {
          detail: { data: "abc" },
        }),
      ),
    ).toBeUndefined();
  });
});
