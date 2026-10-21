#!/usr/bin/env node
/**
 * Wraps @mozilla/firefox-devtools-mcp (--connectExisting) so it attaches to an
 * already-running Firefox-based browser (Zen, Firefox, etc.), auto-restarting
 * the browser with Marionette enabled when needed.
 *
 * Options:
 *   --app <name>        macOS app name used for `open -a` and quit  (default: Zen)
 *   --process <name>    process name for pgrep -x               (default: zen)
 *   --port <port>       Marionette port to listen on / probe    (default: 2828)
 *
 * Logic:
 * - If something is listening on the Marionette port, hand off to the MCP directly.
 * - Otherwise: if the browser is running, quit it gracefully (session restore
 *   keeps tabs), then relaunch with --marionette and wait for the port.
 * - Then spawn the MCP with inherited stdio and wait for it to exit.
 *
 * Usage (e.g. from an MCP client config):
 *   npx github:sushruth/zen-devtools-mcp
 *   npx github:sushruth/zen-devtools-mcp --app Firefox --process firefox --port 2829
 *   bunx github:sushruth/zen-devtools-mcp --app "Zen Browser" --process zen
 */
import net from "node:net";
import { execSync, spawn } from "node:child_process";

function parseArgs(argv) {
  const out = { app: "Zen", process: "zen", port: 2828 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--app" || k === "--process" || k === "--port") {
      const v = argv[++i];
      if (v === undefined) throw new Error(`missing value for ${k}`);
      out[k.slice(2)] = k === "--port" ? Number(v) : v;
    }
  }
  if (!Number.isInteger(out.port) || out.port < 1 || out.port > 65535) {
    throw new Error(`invalid --port: ${out.port}`);
  }
  return out;
}

const { app, process: procName, port: MARIONETTE_PORT } = parseArgs(process.argv.slice(2));
const WAIT_TIMEOUT_MS = 30_000;

function canConnect(targetPort) {
  return new Promise((resolve) => {
    const socket = net.connect({ port: targetPort, host: "127.0.0.1" });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isBrowserRunning() {
  try {
    execSync(`pgrep -x ${JSON.stringify(procName)}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function quitBrowser() {
  execSync(`osascript -e 'quit app ${JSON.stringify(app)}'`, { stdio: "ignore" });
}

async function waitForPort(targetPort, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await canConnect(targetPort)) return true;
    await sleep(500);
  }
  return false;
}

async function ensureBrowser() {
  if (await canConnect(MARIONETTE_PORT)) return;

  if (isBrowserRunning()) {
    // Running but not listening for Marionette -> must restart with the flag.
    console.error(
      `[zen-devtools-mcp] ${app} is running without Marionette; restarting with --marionette (session restore keeps tabs)`,
    );
    quitBrowser();
    const deadline = Date.now() + 15_000;
    while (isBrowserRunning() && Date.now() < deadline) await sleep(500);
  }

  execSync(`open -a ${JSON.stringify(app)} --args --marionette --remote-debugging-port=9222`, {
    stdio: "ignore",
  });

  if (!(await waitForPort(MARIONETTE_PORT, WAIT_TIMEOUT_MS))) {
    console.error(
      `[zen-devtools-mcp] ${app} did not open Marionette on ${MARIONETTE_PORT} in ${WAIT_TIMEOUT_MS / 1000}s; starting MCP anyway (attach will fail)`,
    );
  }
}

await ensureBrowser();

const child = spawn(
  "bunx",
  ["@mozilla/firefox-devtools-mcp@latest", "--connectExisting", "--enableScript"],
  { stdio: "inherit" },
);
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
