// Minimal MCP server — zero external dependencies.
// Implements just enough JSON-RPC over stdio to serve one tool.

import { createInterface } from "readline";
import { join } from "path";
import { tmpdir } from "os";
import { mkdirSync, readFileSync, unlinkSync } from "fs";
import { randomUUID } from "crypto";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const libPath = join(__dirname, "..", "lib", "clipboard.js");
const { hasImage, saveImage, clearImage } = await import("file://" + libPath.replace(/\\/g, "/"));

function send(obj) {
  const msg = JSON.stringify(obj);
  process.stdout.write(msg + "\n");
}

function handleRequest(msg) {
  const { id, method, params } = msg;

  if (method === "initialize") {
    return send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "claude-paste", version: "1.0.0" },
      },
    });
  }

  if (method === "notifications/initialized") return;

  if (method === "tools/list") {
    return send({
      jsonrpc: "2.0",
      id,
      result: {
        tools: [
          {
            name: "paste_screenshot",
            description:
              "Paste a screenshot from the clipboard. Use this when the user says they want to paste, show a screenshot, or share their clipboard image.",
            inputSchema: {
              type: "object",
              properties: {},
            },
          },
        ],
      },
    });
  }

  if (method === "tools/call") {
    const toolName = params?.name;
    if (toolName !== "paste_screenshot") {
      return send({
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: `Unknown tool: ${toolName}` }],
          isError: true,
        },
      });
    }

    if (!hasImage()) {
      return send({
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            {
              type: "text",
              text: "No image found on the clipboard. Take a screenshot first (Win+Shift+S, Cmd+Shift+4, or Print Screen), then try again.",
            },
          ],
        },
      });
    }

    const tempDir = join(tmpdir(), "claude-paste");
    mkdirSync(tempDir, { recursive: true });
    const tempFile = join(tempDir, `screenshot-${randomUUID()}.png`);

    if (!saveImage(tempFile)) {
      return send({
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: "Failed to save clipboard image." }],
          isError: true,
        },
      });
    }

    const imageData = readFileSync(tempFile).toString("base64");

    try {
      unlinkSync(tempFile);
    } catch {}

    clearImage();

    return send({
      jsonrpc: "2.0",
      id,
      result: {
        content: [
          { type: "image", data: imageData, mimeType: "image/png" },
          { type: "text", text: "Screenshot pasted from clipboard." },
        ],
      },
    });
  }

  // Unknown method
  if (id !== undefined) {
    send({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    });
  }
}

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  try {
    handleRequest(JSON.parse(line));
  } catch {}
});
