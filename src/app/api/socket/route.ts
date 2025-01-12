import { WebSocket, WebSocketServer } from "ws";
import { IncomingMessage } from "http";
import redis from "@/lib/redis";
import { deleteFile, getFile, saveFile } from "@/service/fs";
import { Message } from "@/interfaces/socket";

const pubClient = redis.duplicate(); // Redis publisher
const subClient = redis.duplicate(); // Redis subscriber
const clients: Set<WebSocket> = new Set();

subClient.on("connecting", () => {
  console.log(`Subscription client is connecting`);
});

subClient.on("connect", () => {
  console.log(`Subscription client connected`);
});

subClient.on("subscribe", (channel, count) => {
  console.log(
    `Subscribed to channel: ${channel}, active subscriptions: ${count}`
  );
});

// Subscribe to Redis events once
subClient.subscribe("file:events", (err, count) => {
  if (err) {
    // Just like other commands, subscribe() can fail for some reasons,
    // ex network issues.
    console.error("Failed to subscribe: %s", err.message);
  } else {
    // `count` represents the number of channels this client are currently subscribed to.
    console.log(
      `Subscribed successfully! This client is currently subscribed to ${count} channels.`
    );
  }
});

subClient.on("message", (channel, message) => {
  console.log(`Received ${message} from ${channel}`);
  if (channel === "file:events") {
    if (message) {
      const payload = JSON.parse(message);
      console.log("Broadcasting message:", payload);
      clients.forEach((client) => client.send(JSON.stringify(payload)));
    }
  }
});

process.on("SIGINT", async () => {
  await pubClient.quit();
  await subClient.quit();
  process.exit(0);
});

export async function SOCKET(
  client: WebSocket,
  request: IncomingMessage,
  wss: WebSocketServer
) {
  console.log("New WebSocket connection.");
  clients.add(client);

  client.on("message", async (message) => {
    try {
      const str = message.toString();
      console.log(str);
      const { event, body } = JSON.parse(message.toString()) as Message;
      console.log(`Processing ${event}`);

      if (event === "file:created") {
        const { path } = body;
        console.log("Saving file ", path);
        await saveFile(path, "");
        console.log("Saved file ", path);
        const payload = { event: "file:created", body: { path } };
        console.log("payload ", payload);
        await pubClient.publish("file:events", JSON.stringify(payload));
        console.log("published payload");
      } else if (event === "file:updated") {
        const { path, content } = body;
        await saveFile(path, content);
        const payload = { event: "file:updated", body: { path, content } };
        await pubClient.publish("file:events", JSON.stringify(payload));
      } else if (event === "file:deleted") {
        const { path } = body;
        await deleteFile(path);
        const payload = { event: "file:deleted", body: { path } };
        await pubClient.publish("file:events", JSON.stringify(payload));
      } else if (event === "file:moved") {
        const { path, newPath } = body;
        const file = await getFile(path);
        await deleteFile(path);
        await saveFile(newPath, file.content);
        const payload = { event: "file:moved", body: { path, newPath } };
        await pubClient.publish("file:events", JSON.stringify(payload));
      } else {
        throw Error(`Event ${event} with payload ${body} can't be handled.`);
      }
    } catch (error) {
      console.error("Error handling WebSocket message:", error);
    }
  });

  client.on("close", () => {
    clients.delete(client);
    console.log("WebSocket connection closed.");
  });
}
