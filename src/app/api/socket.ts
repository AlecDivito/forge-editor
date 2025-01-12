import redis from "@/lib/redis";
import { IncomingMessage } from "http";
import { Duplex } from "stream";
import { WebSocket, WebSocketServer } from "ws";

const pubClient = redis.duplicate(); // Redis publisher
const subClient = redis.duplicate(); // Redis subscriber
const clients: Set<WebSocket> = new Set();

// Connect Redis Pub/Sub
(async () => {
  await subClient.connect();
  await pubClient.connect();

  // Subscribe to the Redis channel
  subClient.subscribe("file:events", (message) => {
    console.log("Redis event received:", message);

    // Broadcast to all connected WebSocket clients
    const payload = JSON.parse(message);
    clients.forEach((client) => client.send(JSON.stringify(payload)));
  });
})();

// WebSocket API Route
export default function handler(req: any, res: any) {
  if (res.socket.server.wss) {
    console.log("WebSocket server already running.");
  } else {
    console.log("Starting WebSocket server...");

    const wss = new WebSocketServer({ noServer: true });
    res.socket.server.wss = wss;

    wss.on("connection", (ws: WebSocket) => {
      console.log("New WebSocket connection.");
      clients.add(ws);

      ws.on("message", async (message: string) => {
        try {
          const { event, data } = JSON.parse(message);

          if (event === "create:file") {
            const { path } = data;

            // Create the file in Redis with an empty value
            await redis.set(path, "");

            // Publish the file creation event to Redis
            const eventPayload = JSON.stringify({
              event: "file:created",
              data: { path, content: "" },
            });
            await pubClient.publish("file:events", eventPayload);
          }
        } catch (error) {
          console.error("WebSocket message handling error:", error);
        }
      });

      ws.on("close", () => {
        clients.delete(ws);
        console.log("WebSocket connection closed.");
      });
    });

    // Upgrade the connection for WebSocket requests
    res.socket.server.on(
      "upgrade",
      (request: IncomingMessage, socket: Duplex, head: Buffer) => {
        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit("connection", ws, request);
        });
      }
    );
  }

  res.end();
}

export const config = {
  api: {
    bodyParser: false, // Disable body parser for WebSocket connections
  },
};
