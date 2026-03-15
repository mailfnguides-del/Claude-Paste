// UserPromptSubmit hook: collects ALL fresh clipboard images from the queue.
// The watcher saves each screenshot the moment it appears on the clipboard.
// This hook collects everything within the freshness window and sends it all.
// Configurable via CLAUDE_PASTE_FRESHNESS env var (in seconds). Default: 90s.

import { join, basename } from "path";
import { tmpdir } from "os";
import { readdirSync, renameSync, unlinkSync, existsSync, mkdirSync, statSync } from "fs";
import { fileURLToPath } from "url";
import { dirname } from "path";

const freshnessSeconds = parseInt(process.env.CLAUDE_PASTE_FRESHNESS || "90", 10);
const FRESHNESS_THRESHOLD_MS = freshnessSeconds * 1000;

const __dirname = dirname(fileURLToPath(import.meta.url));
const libPath = join(__dirname, "..", "lib", "clipboard.js");
const { clearImage } = await import("file://" + libPath.replace(/\\/g, "/"));

const stateDir = join(tmpdir(), "claude-paste");
const queueDir = join(stateDir, "queue");
const sentDir = join(stateDir, "sent");
mkdirSync(sentDir, { recursive: true });

// Scan queue for fresh screenshots
let freshImages = [];
try {
  if (existsSync(queueDir)) {
    const now = Date.now();
    for (const f of readdirSync(queueDir)) {
      if (!f.endsWith(".png")) continue;
      // Parse timestamp from filename: screenshot-{uuid}-{timestamp}.png
      const match = f.match(/-(\d+)\.png$/);
      if (match) {
        const ts = parseInt(match[1]);
        const age = now - ts;
        if (age < FRESHNESS_THRESHOLD_MS) {
          freshImages.push({ file: join(queueDir, f), name: f, timestamp: ts });
        }
      }
    }
  }
} catch {}

// No fresh images — exit silently
if (freshImages.length === 0) {
  process.exit(0);
}

// Sort by timestamp (oldest first) so Claude sees them in order
freshImages.sort((a, b) => a.timestamp - b.timestamp);

// Clear the current clipboard image (one-time paste semantics)
clearImage();

// Move consumed images from queue/ to sent/ so:
// 1. They're not picked up again by the next hook run
// 2. They remain on disk for Claude to read via the output paths
for (const img of freshImages) {
  const dest = join(sentDir, img.name);
  try {
    renameSync(img.file, dest);
    img.file = dest; // update path for output
  } catch {}
}

// Clean up old sent files (older than 1 hour)
try {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const f of readdirSync(sentDir)) {
    if (!f.endsWith(".png")) continue;
    try {
      const fp = join(sentDir, f);
      if (statSync(fp).mtimeMs < cutoff) unlinkSync(fp);
    } catch {}
  }
} catch {}

// Clean up stale queue files too
try {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const f of readdirSync(queueDir)) {
    if (!f.endsWith(".png")) continue;
    const match = f.match(/-(\d+)\.png$/);
    if (match && parseInt(match[1]) < cutoff) {
      try { unlinkSync(join(queueDir, f)); } catch {}
    }
  }
} catch {}

// Output paths for Claude to read
if (freshImages.length === 1) {
  console.log(`[Clipboard screenshot saved to: ${freshImages[0].file} - read this image to see what the user is showing you]`);
} else {
  const paths = freshImages.map((img, i) => `  ${i + 1}. ${img.file}`).join("\n");
  console.log(`[${freshImages.length} clipboard screenshots detected. Read these images to see what the user is showing you:\n${paths}]`);
}
