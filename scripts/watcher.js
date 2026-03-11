// Background clipboard watcher — runs for the duration of a Claude session.
// Records timestamps when clipboard image content changes.
// Lightweight: uses OS-native clipboard sequence numbers, no image processing.

import { spawn } from "child_process";
import { platform } from "os";
import { join } from "path";
import { tmpdir } from "os";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";

const stateDir = join(tmpdir(), "claude-paste");
mkdirSync(stateDir, { recursive: true });
const stateFile = join(stateDir, "watcher-state.json");
const pidFile = join(stateDir, "watcher.pid");

// Check if a watcher is already running
if (existsSync(pidFile)) {
  try {
    const oldPid = parseInt(readFileSync(pidFile, "utf-8").trim());
    process.kill(oldPid, 0); // Throws if process doesn't exist
    // Watcher already running — exit
    process.exit(0);
  } catch {
    // Old watcher is dead, we'll replace it
  }
}

// Write our PID
writeFileSync(pidFile, process.pid.toString());

// Initialize state as "no fresh image"
writeFileSync(stateFile, JSON.stringify({ hasImage: false, timestamp: 0, pid: process.pid }));

const os = platform();

function writeState(hasImage, timestamp) {
  try {
    writeFileSync(stateFile, JSON.stringify({ hasImage, timestamp, pid: process.pid }));
  } catch {}
}

if (os === "win32") {
  // Windows: use GetClipboardSequenceNumber() for efficient change detection
  const psScript = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "Add-Type -MemberDefinition '[DllImport(\"user32.dll\")] public static extern uint GetClipboardSequenceNumber();' -Name Clip -Namespace Win32",
    "$lastSeq = [Win32.Clip]::GetClipboardSequenceNumber()",
    "while ($true) {",
    "  Start-Sleep -Seconds 2",
    "  $seq = [Win32.Clip]::GetClipboardSequenceNumber()",
    "  if ($seq -ne $lastSeq) {",
    "    $lastSeq = $seq",
    "    if ([System.Windows.Forms.Clipboard]::ContainsImage()) {",
    "      Write-Output 'IMAGE'",
    "    } else {",
    "      Write-Output 'NOIMAGE'",
    "    }",
    "  }",
    "}",
  ].join("\n");

  const ps = spawn("powershell.exe", ["-NoProfile", "-STA", "-Command", psScript], {
    stdio: ["ignore", "pipe", "ignore"],
    windowsHide: true,
  });

  ps.stdout.on("data", (data) => {
    for (const line of data.toString().split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed === "IMAGE") {
        writeState(true, Date.now());
      } else if (trimmed === "NOIMAGE") {
        writeState(false, 0);
      }
    }
  });

  ps.on("exit", () => process.exit());
} else if (os === "darwin") {
  // macOS: poll clipboard info for image types
  const check = () => {
    try {
      const child = spawn("osascript", ["-e", "clipboard info"]);
      let output = "";
      child.stdout.on("data", (d) => (output += d.toString()));
      child.on("close", () => {
        const hasImage = output.includes("PNGf") || output.includes("TIFF");
        // Only update on change
        try {
          const prev = JSON.parse(readFileSync(stateFile, "utf-8"));
          if (hasImage && !prev.hasImage) {
            writeState(true, Date.now());
          } else if (!hasImage && prev.hasImage) {
            writeState(false, 0);
          }
        } catch {
          writeState(hasImage, hasImage ? Date.now() : 0);
        }
      });
    } catch {}
  };
  setInterval(check, 3000);
} else {
  // Linux: check xclip (X11) or wl-paste (Wayland)
  const check = () => {
    const tryCmd = (cmd, args) => {
      try {
        const child = spawn(cmd, args, { timeout: 3000 });
        let output = "";
        child.stdout.on("data", (d) => (output += d.toString()));
        child.on("close", () => {
          const hasImage = output.includes("image/png") || output.includes("image/jpeg");
          try {
            const prev = JSON.parse(readFileSync(stateFile, "utf-8"));
            if (hasImage && !prev.hasImage) {
              writeState(true, Date.now());
            } else if (!hasImage && prev.hasImage) {
              writeState(false, 0);
            }
          } catch {
            writeState(hasImage, hasImage ? Date.now() : 0);
          }
        });
        return true;
      } catch {
        return false;
      }
    };
    if (!tryCmd("xclip", ["-selection", "clipboard", "-t", "TARGETS", "-o"])) {
      tryCmd("wl-paste", ["--list-types"]);
    }
  };
  setInterval(check, 3000);
}

// Self-terminate after 12 hours to prevent orphaned processes
setTimeout(() => process.exit(0), 12 * 60 * 60 * 1000);

// Clean up on exit
process.on("exit", () => {
  try {
    writeFileSync(stateFile, JSON.stringify({ hasImage: false, timestamp: 0, pid: 0 }));
  } catch {}
});
