---
name: configure
description: Configure Claude-Paste settings (freshness threshold for screenshot detection)
---

# Claude-Paste Configuration

Present the user with these freshness threshold options. The freshness threshold controls how recent a screenshot must be (in seconds) to be automatically sent to Claude.

## Steps

1. Show this menu to the user:

```
Claude-Paste Configuration
─────────────────────────

Screenshot freshness threshold (how recent a screenshot must be to auto-send):

  1) 60 seconds  — Fast workflow, screenshot and type immediately
  2) 90 seconds  — Default, good balance for most users
  3) 120 seconds — Relaxed, extra time to compose your message
  4) 180 seconds — Extended, for when you need to think before typing
  5) Custom      — Enter your own value in seconds

Current setting: check the env.CLAUDE_PASTE_FRESHNESS value in ~/.claude/settings.json
(If not set, the default is 90 seconds)
```

2. Wait for the user to pick a number (1-5). If they pick 5, ask them for a custom number of seconds.

3. Once they've chosen, update their `~/.claude/settings.json` file:
   - Read the current file
   - Add or update the `env` object with `"CLAUDE_PASTE_FRESHNESS": "<seconds>"`
   - Write it back
   - Confirm the change to the user

Example of what the settings should look like after:
```json
{
  "env": {
    "CLAUDE_PASTE_FRESHNESS": "120"
  }
}
```

If an `env` object already exists, merge into it (don't overwrite other env vars).

4. Tell the user: "Setting updated. Restart Claude Code for the change to take effect."
