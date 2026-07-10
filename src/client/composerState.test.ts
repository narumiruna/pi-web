import { describe, expect, it } from "vitest";
import { clearSubmittedImages, clearSubmittedText } from "./composerState";

describe("composer submission cleanup", () => {
  it("clears the submitted text only when the draft was not edited", () => {
    expect(clearSubmittedText("sent", "sent")).toBe("");
    expect(clearSubmittedText("new draft", "sent")).toBe("new draft");
  });

  it("removes submitted images while preserving images added in flight", () => {
    const sent = [{ data: "one" }, { data: "two" }];
    const added = { data: "three" };

    expect(clearSubmittedImages(sent, sent)).toEqual([]);
    expect(clearSubmittedImages([...sent, added], sent)).toEqual([added]);
  });
});
