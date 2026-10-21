# zen-devtools-mcp

Wraps [`@mozilla/firefox-devtools-mcp`](https://github.com/mozilla/firefox-devtools-mcp) so it attaches to your **already-running** Firefox-based browser — Zen Browser, Firefox, or any fork — instead of launching a throwaway instance.

The upstream `--connectExisting` mode requires the browser to have been launched with Marionette enabled. Plain relaunches (clicking the dock icon, `open -a Zen`) don't set that, so attaching fails. This wrapper fixes that: if Marionette isn't up, it gracefully quits the browser (session restore keeps your tabs), relaunches it with `--marionette`, waits for the port, then starts the MCP.

## Install / run

No install needed — run it straight from GitHub:

```
npx github:sushruth/zen-devtools-mcp
bunx github:sushruth/zen-devtools-mcp
```

## Options

| Flag | Default | What it controls |
|---|---|---|
| `--app` | `Zen` | macOS app name for `open -a` / quit |
| `--process` | `zen` | process name for `pgrep -x` |
| `--port` | `2828` | Marionette port to probe and listen on |

Examples:

```
# Firefox instead of Zen
npx github:sushruth/zen-devtools-mcp --app Firefox --process firefox

# Zen with a custom Marionette port
npx github:sushruth/zen-devtools-mcp --port 2829
```

## MCP client config

OpenCode example:

```jsonc
"zen-devtools": {
  "type": "local",
  "command": ["bunx", "github:sushruth/zen-devtools-mcp"],
  "enabled": true
},
"firefox-devtools": {
  "type": "local",
  "command": ["bunx", "github:sushruth/zen-devtools-mcp",
              "--app", "Firefox", "--process", "firefox", "--port", "2829"],
  "enabled": true
}
```

Claude Code (`claude mcp add-json zen-devtools '<json>'` or `.mcp.json`):

```json
"zen-devtools": {
  "type": "stdio",
  "command": "bunx",
  "args": ["github:sushruth/zen-devtools-mcp"]
}
```

## Notes

- Session restore preserves tabs across wrapper-triggered restarts.
- Marionette can't be enabled on a live browser process — a restart is unavoidable the first time.
- macOS-only (`open`, `osascript`, `pgrep`).
- Passes `--connectExisting --enableScript` to the underlying MCP; it inherits stdio from its parent.
