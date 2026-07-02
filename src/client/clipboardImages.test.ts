import { describe, expect, it } from "vitest";
import { getPastedImageFiles } from "./clipboardImages";

function file(name: string, content: string, lastModified: number): File {
  return new File([content], name, {
    lastModified,
    type: "image/png",
  });
}

function itemFor(file: File): DataTransferItem {
  return {
    kind: "file",
    type: file.type,
    getAsFile: () => file,
  } as DataTransferItem;
}

function clipboardData(files: File[], items: DataTransferItem[]): DataTransfer {
  return { files, items } as unknown as DataTransfer;
}

describe("getPastedImageFiles", () => {
  it("does not duplicate the same pasted image from files and items", () => {
    const fromFiles = file("image.png", "same image bytes", 1);
    const fromItems = file("image.png", "same image bytes", 2);

    expect(
      getPastedImageFiles(clipboardData([fromFiles], [itemFor(fromItems)])),
    ).toEqual([fromItems]);
  });

  it("falls back to clipboard files when there are no image items", () => {
    const pastedFile = file("image.png", "image bytes", 1);

    expect(getPastedImageFiles(clipboardData([pastedFile], []))).toEqual([
      pastedFile,
    ]);
  });
});
