export const DEFAULT_PORT = 30141;

const MAX_PORT = 65535;
const AUTO_PORT_FALLBACKS = 50;

export function portCandidates(port: number, auto: boolean) {
  if (!auto || port === 0) return [port];

  const last = Math.min(MAX_PORT, port + AUTO_PORT_FALLBACKS);
  const ports: number[] = [];
  for (let candidate = port; candidate <= last; candidate += 1)
    ports.push(candidate);
  return ports;
}

export function isAddressInUse(error: unknown) {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "EADDRINUSE"
  );
}
