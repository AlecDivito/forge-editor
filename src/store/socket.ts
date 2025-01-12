"use client";

type EventHandlers = {
  [event: string]: (data: any) => void;
};

export class WebSocketService {
  private static socket: WebSocket | null = null;
  private static eventHandlers: EventHandlers = {};

  static connect(url: string) {
    console.log(`connecting to ${url}`);
    if (this.socket) {
      console.warn("WebSocket already connected.");
      return;
    }

    this.socket = new WebSocket(url);

    this.socket.onopen = () => {
      console.log("WebSocket connection established.");
    };

    this.socket.onmessage = (event) => {
      const { event: eventType, data } = JSON.parse(event.data);
      const handler = this.eventHandlers[eventType];
      if (handler) {
        handler(data);
      }
    };

    this.socket.onerror = (error) => {
      console.error("WebSocket error:", error);
    };

    this.socket.onclose = () => {
      console.log("WebSocket connection closed.");
      this.socket = null;
    };
  }

  static on(event: string, handler: (data: any) => void) {
    this.eventHandlers[event] = handler;
  }

  static off(event: string) {
    delete this.eventHandlers[event];
  }

  // Private method for sending raw WebSocket messages
  private static send(event: string, data: any) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ event, data }));
    } else {
      console.error("WebSocket is not open.");
    }
  }

  // Public method to create a file
  static createFile(path: string) {
    this.send("create:file", { path });
  }
}

export const websocketService = new WebSocketService();
