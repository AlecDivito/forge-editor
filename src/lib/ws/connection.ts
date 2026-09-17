import { ClientId, ClientMessage, FileId, ServerMessage, WorkspaceId } from "./messages";
import { ConnectionStatus } from "./types";

// lib/ws/connection.ts
type Listener = (msg: ServerMessage) => void;
type StatusListener = () => void;
type ConnectionListener = (generation: number) => void;
type SaveResult = Extract<ServerMessage, { kind: "DocSaveResult" }>;

class SocketManager {
    private ws: WebSocket | null = null;
    private listeners = new Set<Listener>();
    private statusListeners = new Set<StatusListener>();
    private connectionListeners = new Set<ConnectionListener>();
    private reconnectAttempt = 0;
    private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    private connectionToken = 0;
    private _status: ConnectionStatus = { kind: 'idle' };
    private connectionUrl: string | undefined;
    private connectionTokenValue: string | undefined;
    private pendingSaves = new Map<string, {
        resolve: (result: SaveResult) => void;
        reject: (error: Error) => void;
        timeout: ReturnType<typeof setTimeout>;
        documentKey: string;
    }>();
    private inFlightSaves = new Map<string, Promise<SaveResult>>();

    /** The query id is stable for this browser process; Hello confirms it. */
    public clientId = makeClientId() as ClientId;

    get status(): ConnectionStatus {
        return this._status;
    }

    get generation(): number {
        return this.connectionToken;
    }

    connect(ws_url: string, token: string) {
        this.connectionUrl = normalizeWebSocketUrl(ws_url);
        this.connectionTokenValue = token;
        if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = undefined;
        }

        const generation = ++this.connectionToken;
        const url = new URL(this.connectionUrl);
        url.searchParams.set('token', token);
        url.searchParams.set('id', String(this.clientId));
        const ws = new WebSocket(url.toString());
        this.ws = ws;
        this.setStatus({ kind: 'connecting' });
        ws.binaryType = 'arraybuffer';
        ws.onmessage = (e) => {
            if (this.ws !== ws || generation !== this.connectionToken) return;
            const msg = decode(e.data);
            if (!msg || typeof msg.kind !== 'string') return;
            if (msg.kind === "Hello") {
                this.clientId = msg.client_id;
                this.reconnectAttempt = 0;
                this.setStatus({ kind: 'open' });
                this.connectionListeners.forEach((listener) => listener(generation));
            }
            if (msg.kind === "DocSaveResult") {
                const pending = this.pendingSaves.get(msg.request_id);
                if (pending) {
                    this.pendingSaves.delete(msg.request_id);
                    clearTimeout(pending.timeout);
                    this.inFlightSaves.delete(pending.documentKey);
                    if (msg.error) pending.reject(new Error(msg.error));
                    else pending.resolve(msg);
                }
            }
            this.listeners.forEach((l) => l(msg));
        };
        ws.onopen = () => {
            // The server is considered usable only after Hello arrives. This
            // avoids replaying document traffic into a pre-handshake socket.
            ws.send(encode({ kind: 'Hello' } satisfies ClientMessage));
        };
        ws.onclose = () => {
            if (this.ws !== ws || generation !== this.connectionToken) return;
            this.ws = null;
            this.rejectPendingSaves(new Error("WebSocket disconnected while saving"));
            this.setStatus({ kind: 'reconnecting', attempt: this.reconnectAttempt + 1 });
            this.scheduleReconnect();
        };
    }

    /** Send only in the current open connection. Disconnected document and
     * request messages are deliberately dropped and recreated after sync. */
    send(msg: ClientMessage): boolean {
        if (this.status.kind !== 'open' || !this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
        this.ws.send(encode(msg));
        return true;
    }

    /**
     * Send an explicit document save and resolve only when the server has
     * acknowledged the corresponding request id. Saves intentionally do not
     * enter the reconnect replay queue: callers need to retry against the
     * document's current revision after a disconnected request.
     */
    saveDocument(workspaceId: WorkspaceId, fileId: FileId, timeoutMs = 10_000): Promise<SaveResult> {
        const documentKey = `${workspaceId}\u0000${fileId}`;
        const inFlight = this.inFlightSaves.get(documentKey);
        if (inFlight) return inFlight;

        if (this.status.kind !== 'open' || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
            return Promise.reject(new Error("WebSocket is not connected"));
        }

        const requestId = makeRequestId();
        const promise = new Promise<SaveResult>((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pendingSaves.delete(requestId);
                this.inFlightSaves.delete(documentKey);
                reject(new Error(`Timed out saving ${fileId}`));
            }, timeoutMs);
            this.pendingSaves.set(requestId, { resolve, reject, timeout, documentKey });
            this.ws!.send(encode({
                kind: "DocSave",
                workspace_id: workspaceId,
                file_id: fileId,
                request_id: requestId,
            } satisfies ClientMessage));
        });
        this.inFlightSaves.set(documentKey, promise);
        return promise;
    }

    subscribe(listener: Listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    subscribeStatus(listener: StatusListener) {
        this.statusListeners.add(listener);
        return () => this.statusListeners.delete(listener);
    }

    subscribeConnection(listener: ConnectionListener) {
        this.connectionListeners.add(listener);
        return () => this.connectionListeners.delete(listener);
    }

    close(reason: 'client' = 'client') {
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = undefined;
        const ws = this.ws;
        this.ws = null;
        ++this.connectionToken;
        this.rejectPendingSaves(new Error("WebSocket closed"));
        ws?.close();
        this.setStatus({ kind: 'closed', reason });
    }

    private scheduleReconnect() {
        const delay = Math.min(1000 * 2 ** this.reconnectAttempt++, 15000);
        const token = this.connectionToken;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = undefined;
            if (token !== this.connectionToken || this.ws || !this.connectionUrl || !this.connectionTokenValue) return;
            this.connect(this.connectionUrl, this.connectionTokenValue);
        }, delay);
    }

    private setStatus(status: ConnectionStatus) {
        this._status = status;
        this.statusListeners.forEach((listener) => listener());
    }

    private rejectPendingSaves(error: Error) {
        for (const pending of this.pendingSaves.values()) {
            clearTimeout(pending.timeout);
            this.inFlightSaves.delete(pending.documentKey);
            pending.reject(error);
        }
        this.pendingSaves.clear();
    }
}

function makeClientId(): string {
    if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function normalizeWebSocketUrl(value: string): string {
    const url = new URL(value, typeof window === 'undefined' ? 'http://localhost' : window.location.href);
    if (url.protocol === 'http:') url.protocol = 'ws:';
    else if (url.protocol === 'https:') url.protocol = 'wss:';
    if (url.protocol !== 'ws:' && url.protocol !== 'wss:') throw new Error(`Unsupported websocket URL: ${value}`);
    return url.toString();
}

function makeRequestId(): string {
    if (typeof globalThis.crypto?.randomUUID === "function") {
        return globalThis.crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function encode(data: any): string {
    return JSON.stringify(data)
}

function decode(data: string): any {
    return JSON.parse(data)
}

export const socket = new SocketManager(); // one instance, whole app
