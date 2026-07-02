import { mkdtemp, writeFile } from "node:fs/promises";
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

  it("converts SVG images to PNG with the supplied converter", async () => {
    const root = await tempRoot();
    const svgPath = join(root, "diagram.svg");
    await writeFile(svgPath, '<svg xmlns="http://www.w3.org/2000/svg" />');

    const image = await readWorkspaceImage(
      root,
      "diagram.svg",
      async (file) => {
        expect(file).toBe(svgPath);
        return Buffer.from("png bytes");
      },
    );

    expect(image).toMatchObject({
      path: "diagram.svg",
      mimeType: "image/png",
      converted: true,
    });
    expect(image.data.toString()).toBe("png bytes");
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
