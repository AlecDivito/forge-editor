import { socket } from "@/lib/ws/connection";
import { ServerMessage, TerminalId, TerminalStatus, WorkspaceId } from "@/lib/ws/messages";

export type TerminalSession = {
  key: string;
  workspaceId: WorkspaceId;
  id?: TerminalId;
  requestId?: string;
  profileId: string;
  title: string;
  status: TerminalStatus;
  error?: string;
  exit?: { code?: number; signal?: string };
  buffer: Uint8Array[];
  bufferedBytes: number;
};
type View = { write(data: Uint8Array): void; clear?(): void; focus?(): void };
const BUFFER_LIMIT = 1024 * 1024;
const sessions = new Map<string, TerminalSession>();
const views = new Map<string, View>();
const listeners = new Set<() => void>();
let snapshot: readonly TerminalSession[] = [];
const pendingCreates = new Map<string, { resolve: (s: TerminalSession) => void; reject: (e: Error) => void }>();
const pendingTerminates = new Map<string, { resolve: () => void; reject: (e: Error) => void }>();

const sessionKey = (workspaceId: WorkspaceId, id: TerminalId) => `${workspaceId}\0${id}`;
const publish = () => {
  snapshot = [...sessions.values()];
  listeners.forEach((listener) => listener());
};
const requestId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;

function route(message: ServerMessage) {
  if (message.kind === "TerminalCreated") {
    const provisional = sessions.get(`request:${message.request_id}`);
    if (!provisional) return;
    sessions.delete(provisional.key);
    const key = sessionKey(message.workspace_id, message.terminal_id);
    const session = {
      ...provisional,
      key,
      id: message.terminal_id,
      requestId: undefined,
      title: message.title,
      status: "running" as const,
    };
    sessions.set(key, session);
    publish();
    pendingCreates.get(message.request_id)?.resolve(session);
    pendingCreates.delete(message.request_id);
  } else if (message.kind === "TerminalOutput") {
    const key = sessionKey(message.workspace_id, message.terminal_id);
    const session = sessions.get(key);
    if (!session) return;
    const bytes = Uint8Array.from(message.data);
    const view = views.get(key);
    if (view) view.write(bytes);
    else {
      session.buffer.push(bytes);
      session.bufferedBytes += bytes.byteLength;
      let truncated = false;
      while (session.bufferedBytes > BUFFER_LIMIT && session.buffer.length) {
        session.bufferedBytes -= session.buffer.shift()!.byteLength;
        truncated = true;
      }
      if (truncated) {
        const marker = new TextEncoder().encode("\r\n[Earlier terminal output was truncated]\r\n");
        session.buffer.unshift(marker);
        session.bufferedBytes += marker.byteLength;
      }
    }
  } else if (message.kind === "TerminalState") {
    const session = sessions.get(sessionKey(message.workspace_id, message.terminal_id));
    if (!session) return;
    session.status = message.status;
    session.title = message.title;
    session.exit = message.exit;
    publish();
  } else if (message.kind === "TerminalRenamed") {
    const session = sessions.get(sessionKey(message.workspace_id, message.terminal_id));
    if (session) {
      session.title = message.title;
      publish();
    }
  } else if (message.kind === "TerminalTerminateResult") {
    const pending = pendingTerminates.get(message.request_id);
    if (pending) {
      message.error ? pending.reject(new Error(message.error)) : pending.resolve();
      pendingTerminates.delete(message.request_id);
    }
  } else if (message.kind === "TerminalError") {
    const errorRequestId = message.request_id;
    const pending = errorRequestId ? pendingCreates.get(errorRequestId) : undefined;
    if (pending) {
      pending.reject(new Error(message.message));
      pendingCreates.delete(errorRequestId!);
    }
    const session =
      message.terminal_id && message.workspace_id
        ? sessions.get(sessionKey(message.workspace_id, message.terminal_id))
        : message.request_id
          ? sessions.get(`request:${message.request_id}`)
          : undefined;
    if (session) {
      session.status = "error";
      session.error = message.message;
      publish();
    }
  }
}
socket.subscribe(route);
socket.subscribeStatus(() => {
  if (socket.status.kind === "open") return;
  const error = new Error("Terminal disconnected");
  pendingCreates.forEach((pending) => pending.reject(error));
  pendingCreates.clear();
  pendingTerminates.forEach((pending) => pending.reject(error));
  pendingTerminates.clear();
  sessions.forEach((session) => {
    if (session.status === "running" || session.status === "creating" || session.status === "terminating")
      session.status = "disconnected";
  });
  publish();
});

export const terminalRegistry = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot() {
    return snapshot;
  },
  create(workspaceId: WorkspaceId, profileId = "default", cols = 80, rows = 24) {
    const id = requestId();
    const key = `request:${id}`;
    const session: TerminalSession = {
      key,
      workspaceId,
      requestId: id,
      profileId,
      title: "Creating…",
      status: "creating",
      buffer: [],
      bufferedBytes: 0,
    };
    sessions.set(key, session);
    publish();
    return new Promise<TerminalSession>((resolve, reject) => {
      pendingCreates.set(id, { resolve, reject });
      if (
        !socket.send({
          kind: "TerminalCreate",
          request_id: id,
          workspace_id: workspaceId,
          profile_id: profileId,
          cols,
          rows,
        })
      ) {
        pendingCreates.delete(id);
        session.status = "error";
        session.error = "WebSocket is not connected";
        publish();
        reject(new Error(session.error));
      }
    });
  },
  write(session: TerminalSession, data: Uint8Array) {
    return (
      !!session.id &&
      socket.send({
        kind: "TerminalInput",
        workspace_id: session.workspaceId,
        terminal_id: session.id,
        data: Array.from(data),
      })
    );
  },
  resize(session: TerminalSession, cols: number, rows: number) {
    if (session.id)
      socket.send({ kind: "TerminalResize", workspace_id: session.workspaceId, terminal_id: session.id, cols, rows });
  },
  rename(session: TerminalSession, title: string) {
    if (session.id)
      socket.send({ kind: "TerminalRename", workspace_id: session.workspaceId, terminal_id: session.id, title });
  },
  terminate(session: TerminalSession) {
    if (!session.id) return Promise.resolve();
    const id = requestId();
    return new Promise<void>((resolve, reject) => {
      pendingTerminates.set(id, { resolve, reject });
      if (
        !socket.send({
          kind: "TerminalTerminate",
          request_id: id,
          workspace_id: session.workspaceId,
          terminal_id: session.id!,
        })
      ) {
        pendingTerminates.delete(id);
        reject(new Error("WebSocket is not connected"));
      }
    });
  },
  remove(session: TerminalSession) {
    sessions.delete(session.key);
    views.delete(session.key);
    publish();
  },
  clear(session: TerminalSession) {
    views.get(session.key)?.clear?.();
    session.buffer = [];
    session.bufferedBytes = 0;
  },
  focus(session: TerminalSession) {
    views.get(session.key)?.focus?.();
  },
  registerView(session: TerminalSession, view: View) {
    views.set(session.key, view);
    session.buffer.forEach((data) => view.write(data));
    session.buffer = [];
    session.bufferedBytes = 0;
    return () => {
      if (views.get(session.key) === view) views.delete(session.key);
    };
  },
};
