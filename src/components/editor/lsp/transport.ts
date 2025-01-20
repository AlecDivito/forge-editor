import { WebSocketTransport } from "@open-rpc/client-js";

// WebSocketTransportManager: Manages WebSocket connections
class WebSocketTransportManager {
  private static instance: WebSocketTransportManager;
  private transports: Map<string, WebSocketTransport> = new Map();

  private constructor() {}

  public static getInstance(): WebSocketTransportManager {
    if (!WebSocketTransportManager.instance) {
      WebSocketTransportManager.instance = new WebSocketTransportManager();
    }
    return WebSocketTransportManager.instance;
  }

  public getTransport(serverUri: string): WebSocketTransport {
    if (!this.transports.has(serverUri)) {
      const transport = new WebSocketTransport(serverUri);
      this.transports.set(serverUri, transport);
    }
    return this.transports.get(serverUri)!;
  }

  public closeTransport(serverUri: string) {
    const transport = this.transports.get(serverUri);
    if (transport) {
      transport.connection?.close();
      this.transports.delete(serverUri);
    }
  }

  public closeAll() {
    this.transports.forEach((transport) => transport.connection?.close());
    this.transports.clear();
  }
}
