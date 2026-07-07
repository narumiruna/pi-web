import { describe, expect, it } from "vitest";
import {
  hasSecretLikeText,
  parseSnippets,
  trimTerminalBuffer,
} from "./terminalHelpers";

describe("terminal helpers", () => {
  it("trims bounded output", () => {
    expect(trimTerminalBuffer(["a", "b", "c"], 2)).toEqual(["b", "c"]);
  });

  it("detects secret-like output", () => {
    expect(hasSecretLikeText("API_KEY=abc")).toBe(true);
    expect(hasSecretLikeText("all good")).toBe(false);
  });

  it("parses valid snippets only", () => {
    expect(parseSnippets('[{"name":"test","command":"npm test"},{}]')).toEqual([
      { name: "test", command: "npm test" },
    ]);
  });
});
