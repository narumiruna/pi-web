import { describe, expect, it } from "vitest";
import { linkifyText } from "./textLinks";

describe("linkifyText", () => {
  it("turns http URLs into link parts", () => {
    expect(
      linkifyText("Created PR: https://github.com/narumiruna/pi-web/pull/12"),
    ).toEqual([
      { type: "text", text: "Created PR: " },
      {
        type: "link",
        text: "https://github.com/narumiruna/pi-web/pull/12",
        href: "https://github.com/narumiruna/pi-web/pull/12",
      },
    ]);
  });

  it("keeps trailing punctuation outside the link", () => {
    expect(linkifyText("Open https://example.com/path.")).toEqual([
      { type: "text", text: "Open " },
      {
        type: "link",
        text: "https://example.com/path",
        href: "https://example.com/path",
      },
      { type: "text", text: "." },
    ]);
  });

  it("keeps balanced closing parentheses in URLs", () => {
    const url = "https://en.wikipedia.org/wiki/Function_(mathematics)";

    expect(linkifyText(`See ${url}`)).toEqual([
      { type: "text", text: "See " },
      { type: "link", text: url, href: url },
    ]);
  });
});
