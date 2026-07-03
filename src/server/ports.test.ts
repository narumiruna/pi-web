import { describe, expect, it } from "vitest";
import { isAddressInUse, portCandidates } from "./ports.js";

describe("portCandidates", () => {
  it("keeps explicit ports strict", () => {
    expect(portCandidates(30141, false)).toEqual([30141]);
  });

  it("tries nearby ports when auto fallback is enabled", () => {
    const ports = portCandidates(30141, true);
    expect(ports.slice(0, 3)).toEqual([30141, 30142, 30143]);
    expect(ports.at(-1)).toBe(30191);
  });

  it("leaves port 0 to the OS", () => {
    expect(portCandidates(0, true)).toEqual([0]);
  });
});

describe("isAddressInUse", () => {
  it("detects EADDRINUSE errors", () => {
    const error = Object.assign(new Error("busy"), { code: "EADDRINUSE" });
    expect(isAddressInUse(error)).toBe(true);
  });
});
