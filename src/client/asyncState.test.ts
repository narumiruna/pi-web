import { describe, expect, it, vi } from "vitest";
import {
  createLatestRequestGate,
  createSingleFlight,
  isCurrentSelection,
} from "./asyncState";

describe("createSingleFlight", () => {
  it("shares one pending operation across duplicate calls", async () => {
    let resolve!: (value: string) => void;
    const pending = new Promise<string>((done) => {
      resolve = done;
    });
    const task = vi.fn(() => pending);
    const flight = createSingleFlight<string>();

    const first = flight.run(task);
    const second = flight.run(task);
    expect(task).toHaveBeenCalledTimes(1);

    resolve("created");
    await expect(first).resolves.toBe("created");
    await expect(second).resolves.toBe("created");

    await flight.run(async () => "next");
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("allows a retry after a failed operation", async () => {
    const flight = createSingleFlight<string>();

    await expect(
      flight.run(async () => {
        throw new Error("failed");
      }),
    ).rejects.toThrow("failed");
    await expect(flight.run(async () => "recovered")).resolves.toBe(
      "recovered",
    );
  });
});

describe("createLatestRequestGate", () => {
  it("rejects responses superseded by a new request or input change", () => {
    const gate = createLatestRequestGate();
    const first = gate.next();
    const second = gate.next();

    expect(gate.isCurrent(first)).toBe(false);
    expect(gate.isCurrent(second)).toBe(true);

    gate.invalidate();
    expect(gate.isCurrent(second)).toBe(false);
  });
});

describe("isCurrentSelection", () => {
  it("accepts only responses for the selected chat", () => {
    expect(isCurrentSelection("chat-a", "chat-a")).toBe(true);
    expect(isCurrentSelection("chat-a", "chat-b")).toBe(false);
    expect(isCurrentSelection("chat-a", undefined)).toBe(false);
  });
});
