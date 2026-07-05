import { describe, expect, it } from "vitest";
import { parsePort, serviceReady } from "../../extensions/pi-web.js";

describe("parsePort", () => {
  it("rejects a missing --port value", () => {
    expect(() => parsePort("--port")).toThrow("Missing pi-web port");
    expect(() => parsePort("-p")).toThrow("Missing pi-web port");
  });

  it("reads explicit ports", () => {
    expect(parsePort("--port 30150")).toBe(30150);
    expect(parsePort("30151")).toBe(30151);
  });
});

describe("serviceReady", () => {
  it("aborts a hung poll attempt", async () => {
    const started = Date.now();
    const ready = await serviceReady(
      "http://127.0.0.1:1",
      20,
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        }),
    );

    expect(ready).toBe(false);
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
