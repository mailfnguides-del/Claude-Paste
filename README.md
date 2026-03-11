# Claude-Paste

**Paste clipboard screenshots into Claude Code automatically.** Take a screenshot, type your message, and Claude sees it — no dragging files, no extra commands.

Built for [Claude Code](https://claude.ai/claude-code), but the architecture is open and adaptable to any terminal-based AI tool (OpenCode, Gemini CLI, etc.).

## How it works

1. **Take a screenshot** (`Win+Shift+S`, `Cmd+Shift+4`, `Print Screen`, or any tool)
2. **Type your message** in Claude Code and press Enter
3. **Claude sees your screenshot** — automatically attached, no extra steps

That's it. No `/paste` command, no dragging files from a folder, no file paths. Just screenshot → type → done.

### Smart freshness detection

Claude-Paste only sends **fresh** screenshots. If you took a screenshot an hour ago to send to a friend, it won't accidentally get sent to Claude. The plugin tracks clipboard changes in real-time and only attaches images placed on the clipboard within the last 90 seconds.

| Scenario | Result |
|---|---|
| Screenshot → type message immediately | ✅ Sent |
| Screenshot → send to friend → Claude 10 min later | ⏭️ Skipped (stale) |
| Old screenshot from hours ago | ⏭️ Skipped |
| Explicit "paste my clipboard" | ✅ MCP tool works always |

### How it works under the hood

- **Background watcher** starts with your Claude session, monitors clipboard changes using OS-native APIs (Windows: `GetClipboardSequenceNumber`, macOS: `clipboard info`, Linux: `xclip`/`wl-paste`)
- **Prompt hook** fires on every message — checks if a fresh image exists, saves it, tells Claude where to find it, then clears the image from clipboard (one-time paste semantics)
- **MCP tool** (`paste_screenshot`) available as explicit fallback for when you want to paste regardless of freshness

## Installation

### One-command install

In Claude Code, run these two commands:

```
/plugin marketplace add mailfnguides-del/Claude-Paste
/plugin install claude-paste@claude-paste-marketplace
```

That's it. Restart Claude Code and you're ready to paste screenshots.

### Alternative: load directly

```bash
claude --plugin-dir /path/to/Claude-Paste
```

## Requirements

- **Node.js** (any version supported by Claude Code)
- **No npm dependencies** — zero-dependency, pure Node.js built-ins only
- **OS support:**
  - ✅ Windows (PowerShell + Win32 API)
  - ✅ macOS (osascript / AppleScript)
  - ✅ Linux (xclip for X11, wl-paste for Wayland)

## Plugin structure

```
Claude-Paste/
├── .claude-plugin/
│   ├── plugin.json              # Plugin manifest
│   └── marketplace.json         # Marketplace manifest
├── .mcp.json                    # MCP server config
├── hooks/hooks.json             # Hook definitions
├── lib/clipboard.js             # Cross-platform clipboard API
├── scripts/
│   ├── hook.js                  # Prompt hook (auto-paste)
│   └── watcher.js               # Background clipboard monitor
├── server/index.js              # Zero-dep MCP server
├── skills/configure/SKILL.md    # /claude-paste:configure command
├── package.json
├── LICENSE
└── README.md
```

## Adapting for other tools

Claude-Paste is built for Claude Code's plugin system (hooks + MCP), but the core logic is tool-agnostic:

- **`lib/clipboard.js`** — Cross-platform clipboard detection, image saving, and clearing. Works standalone.
- **`scripts/watcher.js`** — Background clipboard monitor with timestamp tracking. Writes to a JSON state file that any tool can read.
- **`server/index.js`** — Minimal MCP server (JSON-RPC over stdio). Can be adapted to any MCP-compatible client.

If you're building integration for another terminal AI tool (OpenCode, Gemini CLI, Aider, etc.), you can reuse `lib/clipboard.js` and `scripts/watcher.js` directly — they have zero dependencies on Claude Code.

## Configuration

### Freshness threshold

The freshness window (how recent a screenshot must be to auto-send) defaults to **90 seconds**. There are two ways to change it:

**Option 1: Slash command (easiest)**

Type `/claude-paste:configure` in Claude Code and pick from presets:

| Preset | Seconds | Best for |
|--------|---------|----------|
| Fast | 60s | Screenshot and type immediately |
| Default | 90s | Good balance for most users |
| Relaxed | 120s | Extra time to compose your message |
| Extended | 180s | When you need to think before typing |
| Custom | any | Enter your own value |

**Option 2: Manual setting**

Add this to your settings (`~/.claude/settings.json`):

```json
{
  "env": {
    "CLAUDE_PASTE_FRESHNESS": "120"
  }
}
```

Or set it in your shell profile for system-wide effect:

```bash
export CLAUDE_PASTE_FRESHNESS=120
```

### Linux requirements

On Linux, you need one of:
- **X11**: `xclip` (`sudo apt install xclip`)
- **Wayland**: `wl-clipboard` (`sudo apt install wl-clipboard`)

The plugin auto-detects your display server via `WAYLAND_DISPLAY` and `DISPLAY` environment variables.

### macOS note

The plugin uses `osascript` (built-in) for clipboard access. For faster performance, optionally install `pngpaste`:

```bash
brew install pngpaste
```

## License

[MIT](LICENSE) — do whatever you want with it.
