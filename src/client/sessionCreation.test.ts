import { describe, expect, it } from "vitest";
import { sessionCreationPayload } from "./sessionCreation";

describe("fixed-workspace session creation", () => {
  it("leaves cwd selection to the authoritative server workspace", () => {
    expect(sessionCreationPayload("ask")).toEqual({ permissionProfile: "ask" });
    expect(sessionCreationPayload("ask")).not.toHaveProperty("cwd");
  });
});
