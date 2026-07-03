#!/usr/bin/env node

const args = process.argv.slice(2);

function take(flag: string, short?: string): string | undefined {
  const index = args.findIndex((arg) => arg === flag || arg === short);
  if (index < 0) return undefined;
  const value = args[index + 1];
  args.splice(index, 2);
  return value;
}

if (args.includes("--help") || args.includes("-h")) {
  console.log(`pi-web

Usage: pi-web [--port 30141] [--hostname 127.0.0.1] [--cwd /path]

Workspace precedence: --cwd, PI_WEB_CWD, WORKSPACE_ROOT, then the current directory.
When neither --port nor PORT is set, pi-web starts at 30141 and tries the next free port.

Examples:
  mkdir example && cd example && pi-web
  npx @narumitw/pi-web
  pi-web --cwd /path/to/project --port 30141

Commands: doctor, status, version`);
  process.exit(0);
}

const command = args[0];
if (command === "version") {
  console.log(process.env.npm_package_version ?? "0.1.0");
  process.exit(0);
}
if (command === "doctor" || command === "status") {
  console.log("pi-web single-process runtime: ok");
  process.exit(0);
}

const port = take("--port", "-p") ?? process.env.PORT;
if (!port) process.env.PI_WEB_AUTO_PORT = "1";
const host = take("--hostname", "-H") ?? process.env.HOST;
const cwd =
  take("--cwd", "-C") ??
  process.env.PI_WEB_CWD ??
  process.env.WORKSPACE_ROOT ??
  process.cwd();
if (port) process.env.PORT = port;
if (host) process.env.HOST = host;
process.env.PI_WEB_CWD = cwd;

await import("./index.js");
