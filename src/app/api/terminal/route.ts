import { WebSocket, WebSocketServer } from "ws";
import { IncomingMessage } from "http";
import * as pty from "node-pty";

// Next.js config (if you use "pages/api/[socket].ts" or similar):
export const config = {
  api: {
    bodyParser: false, // WebSockets don't use body parsing
  },
};

export async function SOCKET(client: WebSocket, request: IncomingMessage, wss: WebSocketServer) {
  console.log("New Terminal WebSocket connection.");

  // If you want to support binary vs. text streaming, set a flag:
  const USE_BINARY = false;

  // Keep track of whether user input has arrived (flush buffer sooner)
  let userInput = false;

  // -------- STRING MESSAGE BUFFERING --------
  function bufferText(socket: WebSocket, flushDelayMs: number, maxSize: number) {
    let s = "";
    let sender: NodeJS.Timeout | null = null;

    return (data: string) => {
      s += data;
      // Flush if we exceed max size or if new user input arrived
      if (s.length > maxSize || userInput) {
        userInput = false;
        socket.send(s);
        s = "";
        if (sender) {
          clearTimeout(sender);
          sender = null;
        }
      } else if (!sender) {
        // Schedule a flush
        sender = setTimeout(() => {
          socket.send(s);
          s = "";
          sender = null;
        }, flushDelayMs);
      }
    };
  }

  // -------- BINARY MESSAGE BUFFERING --------
  function bufferBinary(socket: WebSocket, flushDelayMs: number, maxSize: number) {
    const chunks: Buffer[] = [];
    let length = 0;
    let sender: NodeJS.Timeout | null = null;

    return (data: Buffer) => {
      chunks.push(data);
      length += data.length;

      if (length > maxSize || userInput) {
        userInput = false;
        socket.send(Buffer.concat(chunks));
        chunks.length = 0;
        length = 0;
        if (sender) {
          clearTimeout(sender);
          sender = null;
        }
      } else if (!sender) {
        // Schedule a flush
        sender = setTimeout(() => {
          socket.send(Buffer.concat(chunks));
          chunks.length = 0;
          length = 0;
          sender = null;
        }, flushDelayMs);
      }
    };
  }

  let term = pty.spawn("bash", [], {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    // cwd: process.env.PWD,
    cwd: "/Users/divitoa/code/alecdivito/forge-editor/.workspace-cache/test/test",
    env: process.env, // Pass along the environment, or custom env
    encoding: "utf8",
    useConpty: false, // Windows-only setting, if needed
  });
  console.log("Spawned pty with PID:", term.pid);

  // Pick the buffering strategy depending on whether you want binary or text
  const sendToClient = (USE_BINARY ? bufferBinary : bufferText)(client, /* flushDelayMs: */ 3, /* maxSize: */ 262144);

  // -------- Hook PTY data => WebSocket --------
  term.onData((data) => {
    try {
      // If using binary, data will be a Buffer in node-pty v0.11+ with `encoding: null`.
      // For `encoding: "utf8"`, data is a string. Adjust if needed.
      sendToClient(data);
    } catch (error) {
      // The WebSocket may be closed/unavailable; ignore or handle error
      console.error("Error sending data to client:", error);
    }
  });

  // -------- Hook WebSocket => PTY input --------
  client.on("message", (msg) => {
    // Mark that new user data arrived, so we can flush faster
    userInput = true;

    // Convert to string if needed
    // If your terminal expects raw bytes, you'd handle Buffer differently
    const input = msg.toString();
    term.write(input);
  });

  // -------- Cleanup on socket close --------
  client.on("close", () => {
    // Kill the pty
    term.kill();
    console.log(`Closed terminal with PID: ${term.pid}`);
  });
}
