const LOCAL_PREVIEW_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function previewUrlAllowed(value: string, confirmed = false): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    return LOCAL_PREVIEW_HOSTS.has(url.hostname) || confirmed;
  } catch {
    return false;
  }
}
