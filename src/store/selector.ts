import { fsStore } from ".";

const socket = new WebSocket("ws://your-server-url");

socket.onmessage = (event) => {
  const { type, filePath, content } = JSON.parse(event.data);
  if (type === "updateFile") {
    fsStore.getState().applyServerUpdate(filePath, content);
  }
};

fsStore.setState({ webSocket: socket });
