import { mkdtemp, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { imageMimeFromPath, readWorkspaceImage } from "./workspaceImages.js";

describe("workspace images", () => {
  async function tempRoot() {
    return mkdtemp(join(tmpdir(), "pi-web-images-"));
  }

  it("returns raster images unchanged", async () => {
    const root = await tempRoot();
    await writeFile(join(root, "image.png"), Buffer.from("png bytes"));

    const image = await readWorkspaceImage(root, "image.png");

    expect(image).toMatchObject({
      path: "image.png",
      mimeType: "image/png",
      converted: false,
      size: 9,
    });
    expect(image.data.toString()).toBe("png bytes");
  });

  it("serves SVG images unchanged", async () => {
    const root = await tempRoot();
    await writeFile(
      join(root, "diagram.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg" />',
    );

    const image = await readWorkspaceImage(root, "diagram.svg");

    expect(image).toMatchObject({
      path: "diagram.svg",
      mimeType: "image/svg+xml",
      converted: false,
    });
    expect(image.data.toString()).toContain("<svg");
  });

  it("rejects oversized SVG images before reading them", async () => {
    const root = await tempRoot();
    await writeFile(join(root, "huge.svg"), "<svg />");
    await truncate(join(root, "huge.svg"), 25 * 1024 * 1024 + 1);

    await expect(readWorkspaceImage(root, "huge.svg")).rejects.toThrow(
      /too large/,
    );
  });

  it("rejects workspace traversal", async () => {
    const root = await tempRoot();
    await expect(readWorkspaceImage(root, "../secret.png")).rejects.toThrow(
      /escapes/,
    );
  });

  it("recognizes SVG as an image input type", () => {
    expect(imageMimeFromPath("diagram.svg")).toBe("image/svg+xml");
  });
});
