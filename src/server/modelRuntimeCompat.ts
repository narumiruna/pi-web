import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

type ApiKeyRuntime = Pick<ModelRuntime, "login">;

const PROMPT_ENV_KEYS: ReadonlyArray<[RegExp, string]> = [
  [/cloudflare account id/i, "CLOUDFLARE_ACCOUNT_ID"],
  [/cloudflare ai gateway id/i, "CLOUDFLARE_GATEWAY_ID"],
  [/aws profile name/i, "AWS_PROFILE"],
  [/google cloud project id/i, "GOOGLE_CLOUD_PROJECT"],
  [/google cloud location/i, "GOOGLE_CLOUD_LOCATION"],
  [/service account credentials file path/i, "GOOGLE_APPLICATION_CREDENTIALS"],
];

function envValueForPrompt(
  message: string,
  env: Record<string, string> | undefined,
) {
  const envKey = PROMPT_ENV_KEYS.find(([pattern]) =>
    pattern.test(message),
  )?.[1];
  const value = envKey ? env?.[envKey] : undefined;
  if (value) return value;
  throw new Error(
    envKey
      ? `${envKey} is required for this provider`
      : `Cannot answer provider login prompt: ${message}`,
  );
}

export async function saveApiKey(
  modelRuntime: ApiKeyRuntime,
  providerId: string,
  key: string,
  env?: Record<string, string>,
) {
  await modelRuntime.login(providerId, "api_key", {
    async prompt(prompt) {
      if (prompt.type === "secret") return key;
      if (prompt.type === "select") {
        const apiKeyOption = prompt.options.find((option) =>
          ["api-key", "bearer-token"].includes(option.id),
        );
        if (apiKeyOption) return apiKeyOption.id;
      }
      return envValueForPrompt(prompt.message, env);
    },
    notify() {},
  });
}
