import { ClientMessage, ServerMessage } from "./messages";

// lib/ws/connection.ts
type Listener = (msg: ServerMessage) => void;

class SocketManager {
    private ws: WebSocket | null = null;
    private listeners = new Set<Listener>();
    private sendQueue: ClientMessage[] = [];
    private reconnectAttempt = 0;

    public clientId = "default"

    connect(ws_url: string, token: string) {
        if (this.ws) return;
        this.ws = new WebSocket(`${ws_url}?token=${token}&id=${Math.random()}`);
        this.ws.binaryType = 'arraybuffer';
        this.ws.onmessage = (e) => {
            const msg = decode(e.data);
            this.listeners.forEach((l) => l(msg));
        };
        this.ws.onopen = () => {
            this.reconnectAttempt = 0;
            this.sendQueue.forEach((m) => this.ws!.send(encode(m)));
            this.sendQueue = [];
        };
        this.ws.onclose = () => { this.ws = null; this.scheduleReconnect(ws_url, token); };
    }

    send(msg: ClientMessage) {
        if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(encode(msg));
        else this.sendQueue.push(msg); // resubscribes replay after reconnect too
    }

    subscribe(listener: Listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private scheduleReconnect(url: string, token: string) {
        const delay = Math.min(1000 * 2 ** this.reconnectAttempt++, 15000);
        setTimeout(() => this.connect(url, token), delay);
    }
}

function encode(data: any): string {
    return JSON.stringify(data)
}

function decode(data: string): any {
    return JSON.parse(data)
}

export const socket = new SocketManager(); // one instance, whole app