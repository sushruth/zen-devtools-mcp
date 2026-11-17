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
  "command": ["npx", "-y", "github:sushruth/zen-devtools-mcp"],
  "enabled": true
},
"firefox-devtools": {
  "type": "local",
  "command": ["npx", "-y", "github:sushruth/zen-devtools-mcp",
              "--app", "Firefox", "--process", "firefox", "--port", "2829"],
  "enabled": true
}
```

Claude Code (`claude mcp add-json zen-devtools '<json>'` or `.mcp.json`):

```json
"zen-devtools": {
  "command": "npx",
  "args": ["-y", "github:sushruth/zen-devtools-mcp"]
}
```

## CLI

Each agent session that loads the MCP server starts its own browser connection. The `zen-devtools` CLI shares one connection through a daemon. Element uids from `take_snapshot` stay valid across separate commands.

Start the daemon in the foreground, here under [pueue](https://github.com/Nukesor/pueue):

```
pueue add --group services --label zen-devtools -- zen-devtools daemon
```

`zen-devtools daemon` accepts the same flags as `zen-devtools-mcp` (`--app`, `--process`, `--port`).

Then:

```
zen-devtools status                 # is the daemon up
zen-devtools tools                  # list tools
zen-devtools take_snapshot --help   # usage for one tool
zen-devtools navigate_page https://example.com
zen-devtools take_snapshot
zen-devtools click_by_uid e0
zen-devtools evaluate_script '() => document.title'
```

Required arguments are positional, in schema order. Optional ones are `--name value`; a boolean can be a bare `--name`. Objects and arrays are passed as JSON. Screenshots are saved to a temp file and the path is printed. The socket is `~/.cache/zen-devtools/daemon.sock` (override with `ZEN_DEVTOOLS_SOCK`).

## Notes

- Session restore preserves tabs across wrapper-triggered restarts.
- Marionette can't be enabled on a live browser process — a restart is unavoidable the first time.
- macOS-only (`open`, `osascript`, `pgrep`).
- Passes `--connectExisting --enableScript` to the underlying MCP; it inherits stdio from its parent.
