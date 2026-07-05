import { describe, expect, it } from "vitest";
import { shortcutKey } from "./shortcuts";

type ShortcutInput = Parameters<typeof shortcutKey>[0];
const target = (tagName: string) => ({ tagName }) as unknown as EventTarget;

describe("shortcutKey", () => {
  it("normalizes platform modifier", () => {
    expect(
      shortcutKey({
        key: "D",
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        target: target("BODY"),
      } satisfies ShortcutInput),
    ).toBe("mod+d");
  });

  it("ignores text inputs", () => {
    expect(
      shortcutKey({
        key: "D",
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        target: target("INPUT"),
      } satisfies ShortcutInput),
    ).toBeUndefined();
  });
});
