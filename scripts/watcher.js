// Background clipboard watcher — runs for the duration of a Claude session.
// Saves each new clipboard image to a queue directory as it appears.
// Supports multiple screenshots — each one is preserved for the hook to collect.

import { spawn, execSync } from "child_process";
import { platform } from "os";
import { join } from "path";
import { tmpdir } from "os";
import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "fs";
import { randomUUID } from "crypto";

const stateDir = join(tmpdir(), "claude-paste");
const queueDir = join(stateDir, "queue");
mkdirSync(stateDir, { recursive: true });
mkdirSync(queueDir, { recursive: true });

// Auto-install platform dependencies on first run
const os_name = platform();

function tryExec(cmd, opts = {}) {
  try {
    execSync(cmd, { stdio: "ignore", timeout: opts.timeout || 30000, ...opts });
    return true;
  } catch {
    return false;
  }
}

function cmdExists(cmd) {
  try {
    execSync(`which ${cmd}`, { stdio: "ignore", timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

// Marker file so we only attempt installation once (not every session)
const setupDoneFile = join(stateDir, "setup-complete");
const needsSetup = !existsSync(setupDoneFile);

if (needsSetup) {
  if (os_name === "darwin") {
    if (!cmdExists("pngpaste")) {
      if (cmdExists("brew")) {
        tryExec("brew install pngpaste", { timeout: 60000 });
      } else {
        if (tryExec(
          '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
          { timeout: 120000, env: { ...process.env, NONINTERACTIVE: "1" } }
        )) {
          tryExec("brew install pngpaste", { timeout: 60000 });
        }
      }
    }
  } else if (os_name === "linux") {
    const hasPkgMgr = (cmd) => cmdExists(cmd);
    let installCmd = null;
    if (hasPkgMgr("apt-get")) {
      installCmd = (pkg) => `sudo -n apt-get install -y ${pkg} 2>/dev/null`;
    } else if (hasPkgMgr("dnf")) {
      installCmd = (pkg) => `sudo -n dnf install -y ${pkg} 2>/dev/null`;
    } else if (hasPkgMgr("pacman")) {
      installCmd = (pkg) => `sudo -n pacman -S --noconfirm ${pkg} 2>/dev/null`;
    } else if (hasPkgMgr("zypper")) {
      installCmd = (pkg) => `sudo -n zypper install -y ${pkg} 2>/dev/null`;
    } else if (hasPkgMgr("apk")) {
      installCmd = (pkg) => `sudo -n apk add ${pkg} 2>/dev/null`;
    }
    if (installCmd) {
      if (!cmdExists("xclip")) tryExec(installCmd("xclip"), { timeout: 60000 });
      if (process.env.WAYLAND_DISPLAY && !cmdExists("wl-paste")) {
        tryExec(installCmd("wl-clipboard"), { timeout: 60000 });
      }
    }
  }
  try { writeFileSync(setupDoneFile, new Date().toISOString()); } catch {}
}

const stateFile = join(stateDir, "watcher-state.json");
const pidFile = join(stateDir, "watcher.pid");

// Check if a watcher is already running
if (existsSync(pidFile)) {
  try {
    const oldPid = parseInt(readFileSync(pidFile, "utf-8").trim());
    process.kill(oldPid, 0);
    process.exit(0);
  } catch {}
}

writeFileSync(pidFile, process.pid.toString());
writeFileSync(stateFile, JSON.stringify({ hasImage: false, timestamp: 0, pid: process.pid }));

const os = platform();

function writeState(hasImage, timestamp) {
  try {
    writeFileSync(stateFile, JSON.stringify({ hasImage, timestamp, pid: process.pid }));
  } catch {}
}

// Periodically clean up old queue files (older than 5 minutes)
function cleanQueue() {
  try {
    const cutoff = Date.now() - 5 * 60 * 1000;
    for (const f of readdirSync(queueDir)) {
      if (!f.endsWith(".png")) continue;
      // Parse timestamp from filename: screenshot-{uuid}-{timestamp}.png
      const match = f.match(/-(\d+)\.png$/);
      if (match) {
        const ts = parseInt(match[1]);
        if (ts < cutoff) {
          try { unlinkSync(join(queueDir, f)); } catch {}
        }
      }
    }
  } catch {}
}

setInterval(cleanQueue, 60000);

if (os === "win32") {
  // Windows: save images directly from the long-running PowerShell process
  const queueDirPS = queueDir.replace(/\//g, "\\");
  const psScript = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "Add-Type -AssemblyName System.Drawing",
    "Add-Type -MemberDefinition '[DllImport(\"user32.dll\")] public static extern uint GetClipboardSequenceNumber();' -Name Clip -Namespace Win32",
    "$lastSeq = [Win32.Clip]::GetClipboardSequenceNumber()",
    "while ($true) {",
    "  Start-Sleep -Seconds 2",
    "  $seq = [Win32.Clip]::GetClipboardSequenceNumber()",
    "  if ($seq -ne $lastSeq) {",
    "    $lastSeq = $seq",
    "    if ([System.Windows.Forms.Clipboard]::ContainsImage()) {",
    "      $img = [System.Windows.Forms.Clipboard]::GetImage()",
    "      if ($img -ne $null) {",
    "        $ts = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()",
    "        $guid = [guid]::NewGuid().ToString()",
    `        $path = '${queueDirPS}' + '\\screenshot-' + $guid + '-' + $ts + '.png'`,
    "        $img.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)",
    "        $img.Dispose()",
    "        Write-Output ('IMAGE:' + $ts)",
    "      }",
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
      if (trimmed.startsWith("IMAGE:")) {
        const ts = parseInt(trimmed.split(":")[1]);
        writeState(true, ts);
      } else if (trimmed === "NOIMAGE") {
        writeState(false, 0);
      }
    }
  });

  ps.on("exit", () => process.exit());
} else if (os === "darwin") {
  // macOS: poll and save images when clipboard changes
  let lastHadImage = false;

  const saveClipboardImage = () => {
    const ts = Date.now();
    const filePath = join(queueDir, `screenshot-${randomUUID()}-${ts}.png`);
    try {
      if (cmdExists("pngpaste")) {
        execSync(`pngpaste "${filePath}"`, { timeout: 10000 });
        if (existsSync(filePath) && statSync(filePath).size > 0) return ts;
        return null;
      }
      const appleScript = [
        "try",
        '  set imgData to the clipboard as «class PNGf»',
        `  set filePath to POSIX path of (POSIX file "${filePath}")`,
        "  set fileRef to open for access filePath with write permission",
        "  set eof fileRef to 0",
        "  write imgData to fileRef",
        "  close access fileRef",
        '  return "SAVED"',
        "on error",
        '  return "NO_IMAGE"',
        "end try",
      ].join("\n");
      const r = execSync(`osascript -e '${appleScript.replace(/'/g, "'\\''")}'`, {
        encoding: "utf-8",
        timeout: 10000,
      }).trim();
      return r === "SAVED" ? ts : null;
    } catch {
      return null;
    }
  };

  const check = () => {
    try {
      const child = spawn("osascript", ["-e", "clipboard info"]);
      let output = "";
      child.stdout.on("data", (d) => (output += d.toString()));
      child.on("close", () => {
        const hasImage = output.includes("PNGf") || output.includes("TIFF");
        if (hasImage && !lastHadImage) {
          const ts = saveClipboardImage();
          if (ts) writeState(true, ts);
        } else if (!hasImage && lastHadImage) {
          writeState(false, 0);
        }
        lastHadImage = hasImage;
      });
    } catch {}
  };
  setInterval(check, 3000);
} else {
  // Linux: poll and save images when clipboard changes
  let lastHadImage = false;
  const linuxClipTool = process.env.WAYLAND_DISPLAY && cmdExists("wl-paste") ? "wayland"
    : cmdExists("xclip") ? "xclip"
    : cmdExists("wl-paste") ? "wayland" : null;

  const saveClipboardImage = () => {
    const ts = Date.now();
    const filePath = join(queueDir, `screenshot-${randomUUID()}-${ts}.png`);
    try {
      if (linuxClipTool === "xclip") {
        execSync(`xclip -selection clipboard -t image/png -o > "${filePath}" 2>/dev/null`, {
          timeout: 10000, shell: true,
        });
      } else if (linuxClipTool === "wayland") {
        execSync(`wl-paste --type image/png > "${filePath}" 2>/dev/null`, {
          timeout: 10000, shell: true,
        });
      }
      return existsSync(filePath) && statSync(filePath).size > 0 ? ts : null;
    } catch {
      return null;
    }
  };

  const check = () => {
    if (!linuxClipTool) return;
    const cmd = linuxClipTool === "xclip"
      ? ["xclip", ["-selection", "clipboard", "-t", "TARGETS", "-o"]]
      : ["wl-paste", ["--list-types"]];
    try {
      const child = spawn(cmd[0], cmd[1], { timeout: 3000 });
      let output = "";
      child.stdout.on("data", (d) => (output += d.toString()));
      child.on("close", () => {
        const hasImage = output.includes("image/png") || output.includes("image/jpeg");
        if (hasImage && !lastHadImage) {
          const ts = saveClipboardImage();
          if (ts) writeState(true, ts);
        } else if (!hasImage && lastHadImage) {
          writeState(false, 0);
        }
        lastHadImage = hasImage;
      });
    } catch {}
  };
  setInterval(check, 3000);
}

// Self-terminate after 12 hours
setTimeout(() => process.exit(0), 12 * 60 * 60 * 1000);

// Clean up on exit
process.on("exit", () => {
  try {
    writeFileSync(stateFile, JSON.stringify({ hasImage: false, timestamp: 0, pid: 0 }));
  } catch {}
});
