import { WebSocket, WebSocketServer } from "ws";
import { spawn } from "child_process";
import { IncomingMessage } from "http";
import redis from "@/lib/redis";

const supportedLSPs: Record<string, { cmd: string; args: string[] }> = {
  go: { cmd: "gopls", args: ["serve"] },
  rs: { cmd: "rust-analyzer", args: [] },
  ts: { cmd: "typescript-language-server", args: ["--stdio"] },
  js: { cmd: "typescript-language-server", args: ["--stdio"] },
  py: { cmd: "pyls", args: [] },
  yaml: { cmd: "yaml-language-server", args: ["--stdio"] },
  json: { cmd: "vscode-json-languageserver", args: ["--stdio"] },
  markdown: { cmd: "markdown-language-server", args: ["--stdio"] },
  html: { cmd: "vscode-html-languageserver", args: ["--stdio"] },
  css: { cmd: "vscode-css-languageserver", args: ["--stdio"] },
};

export async function SOCKET(
  client: WebSocket,
  request: IncomingMessage,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  wss: WebSocketServer
) {
  console.log("New LSP WebSocket connection.");

  const languageMatch = request.url?.match(/\/api\/lsp\/([a-zA-Z0-9]+)/);
  const language = languageMatch?.[1];

  if (!language || !supportedLSPs[language]) {
    console.error(`Unsupported language: ${language}`);
    client.send(JSON.stringify({ error: `Unsupported language: ${language}` }));
    client.close();
    return;
  }

  const { cmd, args } = supportedLSPs[language];
  console.log(`Starting LSP for language: ${language} with command: ${cmd}`);

  const lspProcess = spawn(cmd, args);
  let messageBuffer = "";

  client.on("message", async (message) => {
    try {
      const str = message.toString();
      const parsed = JSON.parse(str);

      if (parsed.method === "workspace/workspaceFolders") {
        const workspaceFolders = [
          {
            uri: "file:///workspace/",
            name: "RedisWorkspace",
          },
        ];
        client.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id: parsed.id,
            result: workspaceFolders,
          })
        );
        return;
      }

      if (
        parsed.method === "textDocument/didOpen" ||
        parsed.method === "textDocument/didChange"
      ) {
        const uri = parsed.params.textDocument.uri;
        if (uri.startsWith("file:///workspace/")) {
          const path = uri.replace("file:///workspace/", "");
          let fileContent = await redis.get(path);

          if (!fileContent) {
            if (path === "Cargo.toml") {
              // Dynamically generate a minimal Cargo.toml
              fileContent = `[package]
name = "example"
version = "0.1.0"
edition = "2021"

[dependencies]
`;
            } else {
              console.error(`File ${path} not found in Redis.`);
              fileContent = ""; // Serve empty file if not found
            }
          }

          parsed.params.textDocument.text = fileContent;
        }
      }

      const updatedMessage = JSON.stringify(parsed);
      lspProcess.stdin.write(
        `Content-Length: ${updatedMessage.length}\r\n\r\n${updatedMessage}`
      );
    } catch (error) {
      console.error("Error processing client message:", error);
    }
  });

  lspProcess.stdout.on("data", (data) => {
    messageBuffer += data.toString();

    while (true) {
      const contentLengthMatch = messageBuffer.match(/Content-Length: (\d+)/);
      if (!contentLengthMatch) break;

      const contentLength = parseInt(contentLengthMatch[1], 10);
      const headerEnd = messageBuffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) break;

      const start = headerEnd + 4;
      const end = start + contentLength;

      if (messageBuffer.length < end) break;

      const message = messageBuffer.slice(start, end);
      client.send(message);

      messageBuffer = messageBuffer.slice(end);
    }
  });

  lspProcess.stderr.on("data", (data) => {
    console.error(`LSP stderr: ${data.toString()}`);
  });

  client.on("close", () => {
    console.log("WebSocket connection closed.");
    lspProcess.kill();
  });

  lspProcess.on("exit", (code) => {
    console.log(`LSP process exited with code ${code}`);
  });
}

export const config = {
  api: {
    bodyParser: false,
  },
};
