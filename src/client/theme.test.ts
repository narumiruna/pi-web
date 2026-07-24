import { describe, expect, it } from "vitest";
import { parseTheme, radixThemeProps, resolveTheme } from "./theme";

describe("Radix theme adapter", () => {
  it("keeps supported stored choices and falls back to light", () => {
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme("system")).toBe("system");
    expect(parseTheme("unknown")).toBe("light");
    expect(parseTheme(null)).toBe("light");
  });

  it("resolves the system choice from the current color preference", () => {
    expect(resolveTheme("system", true)).toBe("light");
    expect(resolveTheme("system", false)).toBe("dark");
    expect(resolveTheme("dark", true)).toBe("dark");
  });

  it("provides the approved compact technical Radix theme", () => {
    expect(radixThemeProps("dark")).toEqual({
      appearance: "dark",
      accentColor: "blue",
      grayColor: "slate",
      radius: "small",
      scaling: "90%",
    });
  });
});
