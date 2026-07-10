import { describe, expect, it } from "vitest";
import { isMobileLayout, shouldAutoHideSidebar } from "./responsiveLayout";

describe("responsive sidebar state", () => {
  it("uses the same inclusive mobile breakpoint as CSS", () => {
    expect(isMobileLayout(860)).toBe(true);
    expect(isMobileLayout(861)).toBe(false);
  });

  it("auto-hides only when crossing from desktop into mobile", () => {
    expect(shouldAutoHideSidebar(1200, 800)).toBe(true);
    expect(shouldAutoHideSidebar(800, 700)).toBe(false);
    expect(shouldAutoHideSidebar(700, 1200)).toBe(false);
  });
});
