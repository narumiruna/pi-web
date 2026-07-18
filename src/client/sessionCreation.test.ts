import { describe, expect, it } from "vitest";
import { sessionCreationPayload } from "./sessionCreation";

describe("fixed-workspace session creation", () => {
  it("leaves cwd selection to the authoritative server workspace", () => {
    expect(sessionCreationPayload("full")).toEqual({
      permissionProfile: "full",
    });
    expect(sessionCreationPayload("full")).not.toHaveProperty("cwd");
  });
});
