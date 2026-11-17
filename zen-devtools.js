#!/usr/bin/env node
/**
 * zen-devtools — CLI for Zen browser control without an MCP server per session.
 *
 *   zen-devtools daemon [zen-devtools-mcp flags]   foreground; run it under pueue
 *   zen-devtools status | tools
 *   zen-devtools <tool> <required args...> [--optional value] [--bool]
 *   zen-devtools <tool> --help
 *
 * The daemon keeps one zen-devtools-mcp.js child (and so one browser connection)
 * alive, so element uids from a snapshot stay valid for later commands.
 */
import net from "node:net";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdirSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SOCK = process.env.ZEN_DEVTOOLS_SOCK || join(homedir(), ".cache", "zen-devtools", "daemon.sock");
const START_HINT = "pueue add --group services --label zen-devtools -- zen-devtools daemon";

function call(method, params) {
  return new Promise((resolve, reject) => {
    // ponytail: no timeout; Ctrl-C a hung call
    const sock = net.createConnection(SOCK);
    sock.on("error", (e) =>
      reject(
        e.code === "ENOENT" || e.code === "ECONNREFUSED"
          ? new Error(`daemon not running. Start it with:\n  ${START_HINT}`)
          : e,
      ),
    );
    sock.write(JSON.stringify({ method, params }) + "\n");
    const lines = createInterface({ input: sock });
    lines.on("error", () => {});
    lines.once("line", (line) => {
      sock.destroy();
      const r = JSON.parse(line);
      r.error ? reject(new Error(r.error)) : resolve(r.result);
    });
  });
}

async function daemon(args) {
  if (await call("ping").then(() => true, () => false)) {
    console.error(`[zen-devtools] a daemon is already listening on ${SOCK}`);
    process.exit(1);
  }

  const wrapper = join(dirname(fileURLToPath(import.meta.url)), "zen-devtools-mcp.js");
  const child = spawn(process.execPath, [wrapper, ...args], { stdio: ["pipe", "pipe", "inherit"] });
  const cleanup = () => {
    try { unlinkSync(SOCK); } catch {}
  };
  child.on("exit", (code) => {
    cleanup();
    console.error(`[zen-devtools] MCP child exited (${code}); daemon stopping`);
    process.exit(code || 1);
  });
  for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"]) {
    process.on(sig, () => {
      cleanup();
      child.kill(sig);
      process.exit(0);
    });
  }

  const send = (msg) => child.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...msg }) + "\n");
  const pending = new Map();
  let nextId = 1;
  const rpc = (method, params) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      send({ id, method, params });
    });

  createInterface({ input: child.stdout }).on("line", (line) => {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    if (msg.method) {
      // A request from the server; only ping is expected.
      if (msg.id != null) {
        send(msg.method === "ping"
          ? { id: msg.id, result: {} }
          : { id: msg.id, error: { code: -32601, message: "method not found" } });
      }
      return;
    }
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
  });

  await rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "zen-devtools", version: "1.0.0" },
  });
  send({ method: "notifications/initialized" });

  mkdirSync(dirname(SOCK), { recursive: true, mode: 0o700 });
  cleanup();
  net
    .createServer((sock) => {
      sock.on("error", () => {});
      createInterface({ input: sock }).once("line", async (line) => {
        try {
          const { method, params } = JSON.parse(line);
          sock.end(JSON.stringify({ result: await rpc(method, params) }) + "\n");
        } catch (e) {
          sock.end(JSON.stringify({ error: e.message }) + "\n");
        }
      });
    })
    .listen(SOCK, () => console.error(`[zen-devtools] listening on ${SOCK}`));
}

function usage(tool) {
  const props = tool.inputSchema?.properties ?? {};
  const required = tool.inputSchema?.required ?? [];
  const parts = Object.keys(props).map((k) => (required.includes(k) ? `<${k}>` : `[--${k}]`));
  return [`zen-devtools ${tool.name} ${parts.join(" ")}`.trim(), tool.description ?? ""]
    .concat(Object.entries(props).map(([k, p]) => `  ${k} (${p.type ?? "any"}): ${p.description ?? ""}`))
    .join("\n");
}

function coerce(value, type) {
  if (type === "number" || type === "integer") return Number(value);
  if (type === "boolean") return value !== "false";
  if (type === "object" || type === "array") return JSON.parse(value);
  return value;
}

export function parseToolArgs(tool, argv) {
  const props = tool.inputSchema?.properties ?? {};
  const positional = [...(tool.inputSchema?.required ?? [])];
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      if (!(key in props)) throw new Error(`unknown option --${key}\n\n${usage(tool)}`);
      const type = props[key].type;
      const next = argv[i + 1];
      if (type === "boolean" && (next === undefined || !["true", "false"].includes(next))) out[key] = true;
      else if (next === undefined) throw new Error(`missing value for --${key}`);
      else out[key] = coerce(argv[++i], type);
    } else {
      const key = positional.find((k) => !(k in out));
      if (!key) throw new Error(`unexpected argument ${a}\n\n${usage(tool)}`);
      out[key] = coerce(a, props[key]?.type);
    }
  }
  const missing = positional.filter((k) => !(k in out));
  if (missing.length) throw new Error(`missing ${missing.map((k) => `<${k}>`).join(" ")}\n\n${usage(tool)}`);
  return out;
}

function print(result) {
  for (const c of result.content ?? []) {
    if (c.type === "text") console.log(c.text);
    else if (c.type === "image") {
      const ext = (c.mimeType ?? "image/png").split("/")[1];
      const file = join(tmpdir(), `zen-devtools-${Date.now()}.${ext}`);
      writeFileSync(file, Buffer.from(c.data, "base64"));
      console.log(file);
    } else console.log(JSON.stringify(c));
  }
  if (result.isError) process.exitCode = 1;
}

async function main([cmd, ...rest]) {
  if (cmd === "daemon") return daemon(rest);
  if (!cmd || cmd === "--help" || cmd === "help") {
    console.log("usage: zen-devtools daemon | status | tools | <tool> [args] | <tool> --help");
    return;
  }
  if (cmd === "status") {
    await call("ping");
    console.log(`running, socket ${SOCK}`);
    return;
  }
  const { tools } = await call("tools/list");
  if (cmd === "tools") {
    for (const t of tools) console.log(`${t.name}\t${(t.description ?? "").split("\n")[0]}`);
    return;
  }
  const tool = tools.find((t) => t.name === cmd);
  if (!tool) throw new Error(`unknown command ${cmd}; run \`zen-devtools tools\``);
  if (rest.includes("--help")) return console.log(usage(tool));
  print(await call("tools/call", { name: cmd, arguments: parseToolArgs(tool, rest) }));
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
