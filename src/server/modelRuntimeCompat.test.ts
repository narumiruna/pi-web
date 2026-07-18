import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ModelRuntime,
  readStoredCredential,
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { saveApiKey } from "./modelRuntimeCompat.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function runtimeWithTemporaryAuth() {
  const directory = await mkdtemp(join(tmpdir(), "pi-web-auth-"));
  temporaryDirectories.push(directory);
  const authPath = join(directory, "auth.json");
  const runtime = await ModelRuntime.create({
    authPath,
    modelsPath: null,
    allowModelNetwork: false,
  });
  return { authPath, runtime };
}

describe("saveApiKey", () => {
  it("persists a standard provider API key", async () => {
    const { authPath, runtime } = await runtimeWithTemporaryAuth();

    await saveApiKey(runtime, "anthropic", "test-key");

    expect(readStoredCredential("anthropic", authPath)).toEqual({
      type: "api_key",
      key: "test-key",
    });
  });

  it("supplies provider-specific environment fields", async () => {
    const { authPath, runtime } = await runtimeWithTemporaryAuth();

    await saveApiKey(runtime, "cloudflare-workers-ai", "test-key", {
      CLOUDFLARE_ACCOUNT_ID: "test-account",
    });

    expect(readStoredCredential("cloudflare-workers-ai", authPath)).toEqual({
      type: "api_key",
      key: "test-key",
      env: { CLOUDFLARE_ACCOUNT_ID: "test-account" },
    });
  });
});
