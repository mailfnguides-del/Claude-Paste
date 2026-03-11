// Cross-platform clipboard image detection, saving, and clearing.
// Zero external dependencies — uses only Node.js built-ins + OS tools.

import { execSync } from "child_process";
import { platform } from "os";

const os = platform();

export function hasImage() {
  try {
    if (os === "win32") {
      const r = execSync(
        'powershell.exe -NoProfile -STA -Command "Add-Type -AssemblyName System.Windows.Forms; Write-Output ([System.Windows.Forms.Clipboard]::ContainsImage())"',
        { encoding: "utf-8", timeout: 5000 }
      ).trim();
      return r === "True";
    }
    if (os === "darwin") {
      const r = execSync('osascript -e "clipboard info"', {
        encoding: "utf-8",
        timeout: 5000,
      });
      return r.includes("PNGf") || r.includes("TIFF");
    }
    // Linux — try X11 first, then Wayland
    try {
      const r = execSync("xclip -selection clipboard -t TARGETS -o 2>/dev/null", {
        encoding: "utf-8",
        timeout: 5000,
      });
      return r.includes("image/png") || r.includes("image/jpeg");
    } catch {
      const r = execSync("wl-paste --list-types 2>/dev/null", {
        encoding: "utf-8",
        timeout: 5000,
      });
      return r.includes("image/png") || r.includes("image/jpeg");
    }
  } catch {
    return false;
  }
}

export function saveImage(filePath) {
  try {
    if (os === "win32") {
      const psPath = filePath.replace(/\//g, "\\");
      const script = [
        "Add-Type -AssemblyName System.Windows.Forms",
        "Add-Type -AssemblyName System.Drawing",
        "$img = [System.Windows.Forms.Clipboard]::GetImage()",
        "if ($img -eq $null) { exit 1 }",
        `$img.Save('${psPath}', [System.Drawing.Imaging.ImageFormat]::Png)`,
        "$img.Dispose()",
      ].join("; ");
      execSync(`powershell.exe -NoProfile -STA -Command "${script}"`, { timeout: 10000 });
      return true;
    }
    if (os === "darwin") {
      const appleScript = `
        try
          set imgData to the clipboard as «class PNGf»
          set filePath to POSIX path of (POSIX file "${filePath}")
          set fileRef to open for access filePath with write permission
          set eof fileRef to 0
          write imgData to fileRef
          close access fileRef
          return "SAVED"
        on error
          return "NO_IMAGE"
        end try`;
      const r = execSync(`osascript -e '${appleScript.replace(/'/g, "'\\''")}'`, {
        encoding: "utf-8",
        timeout: 10000,
      }).trim();
      return r === "SAVED";
    }
    // Linux — try X11, then Wayland
    try {
      execSync(`xclip -selection clipboard -t image/png -o > "${filePath}" 2>/dev/null`, {
        timeout: 10000,
      });
      return true;
    } catch {
      execSync(`wl-paste --type image/png > "${filePath}" 2>/dev/null`, {
        timeout: 10000,
      });
      return true;
    }
  } catch {
    return false;
  }
}

export function clearImage() {
  try {
    if (os === "win32") {
      // Preserve text, clear only image
      const script = [
        "Add-Type -AssemblyName System.Windows.Forms",
        "$text = $null",
        "if ([System.Windows.Forms.Clipboard]::ContainsText()) { $text = [System.Windows.Forms.Clipboard]::GetText() }",
        "[System.Windows.Forms.Clipboard]::Clear()",
        "if ($text -ne $null) { [System.Windows.Forms.Clipboard]::SetText($text) }",
      ].join("; ");
      execSync(`powershell.exe -NoProfile -STA -Command "${script}"`, { timeout: 5000 });
    } else if (os === "darwin") {
      // Clear clipboard image but preserve text
      const appleScript = `
        try
          set txt to the clipboard as text
          set the clipboard to ""
          set the clipboard to txt
        on error
          set the clipboard to ""
        end try`;
      execSync(`osascript -e '${appleScript.replace(/'/g, "'\\''")}'`, { timeout: 5000 });
    } else {
      // Linux — set clipboard to empty to clear image
      try {
        execSync('echo -n "" | xclip -selection clipboard 2>/dev/null', { timeout: 5000 });
      } catch {
        execSync('echo -n "" | wl-copy 2>/dev/null', { timeout: 5000 });
      }
    }
  } catch {
    // Clearing is best-effort
  }
}
