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
const host = take("--hostname", "-H") ?? process.env.HOST;
const cwd = take("--cwd", "-C") ?? process.env.PI_WEB_CWD;
if (port) process.env.PORT = port;
if (host) process.env.HOST = host;
if (cwd) process.env.PI_WEB_CWD = cwd;

await import("./index.js");
