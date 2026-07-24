import type { Theme } from "./types";

export const THEME_STORAGE_KEY = "pi-web.theme";

export type ResolvedTheme = Exclude<Theme, "system">;

export function parseTheme(value: string | null): Theme {
  return value === "dark" || value === "light" || value === "system"
    ? value
    : "light";
}

export function resolveTheme(
  theme: Theme,
  prefersLight: boolean,
): ResolvedTheme {
  if (theme !== "system") return theme;
  return prefersLight ? "light" : "dark";
}

export function radixThemeProps(appearance: ResolvedTheme) {
  return {
    appearance,
    accentColor: "blue" as const,
    grayColor: "slate" as const,
    radius: "small" as const,
    scaling: "90%" as const,
  };
}
