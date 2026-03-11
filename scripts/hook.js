// UserPromptSubmit hook: only sends clipboard images that are FRESH.
// Reads the watcher's state file to check when the clipboard image appeared.
// Threshold: 90 seconds — if the image was placed more than 90s ago, skip it.

import { join } from "path";
import { tmpdir } from "os";
import { mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, existsSync } from "fs";
import { randomUUID } from "crypto";
import { fileURLToPath } from "url";
import { dirname } from "path";

const FRESHNESS_THRESHOLD_MS = 90 * 1000; // 90 seconds

const __dirname = dirname(fileURLToPath(import.meta.url));
const libPath = join(__dirname, "..", "lib", "clipboard.js");
const { hasImage, saveImage, clearImage } = await import("file://" + libPath.replace(/\\/g, "/"));

const stateDir = join(tmpdir(), "claude-paste");
const stateFile = join(stateDir, "watcher-state.json");

// First check: is there even an image on the clipboard?
if (!hasImage()) {
  process.exit(0);
}

// Second check: is it fresh? (Was it placed on clipboard recently?)
let isFresh = false;
try {
  if (existsSync(stateFile)) {
    const state = JSON.parse(readFileSync(stateFile, "utf-8"));
    if (state.hasImage && state.timestamp > 0) {
      const age = Date.now() - state.timestamp;
      isFresh = age < FRESHNESS_THRESHOLD_MS;
    }
  }
} catch {
  // If state file is unreadable, err on the side of not sending
}

if (!isFresh) {
  process.exit(0);
}

// Fresh image — save it
mkdirSync(stateDir, { recursive: true });
const tempFile = join(stateDir, `screenshot-${randomUUID()}.png`);

if (!saveImage(tempFile)) {
  process.exit(0);
}

// Clear image from clipboard (one-time paste semantics)
clearImage();

// Clean up temp files older than 1 hour
try {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const f of readdirSync(stateDir)) {
    if (f.startsWith("screenshot-") && f.endsWith(".png")) {
      try {
        const fp = join(stateDir, f);
        if (statSync(fp).mtimeMs < cutoff) unlinkSync(fp);
      } catch {}
    }
  }
} catch {}

// Output path for Claude to read the image
console.log(`[Clipboard screenshot saved to: ${tempFile} - read this image to see what the user is showing you]`);
