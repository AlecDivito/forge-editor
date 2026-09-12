import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from "y-protocols/awareness";
import { socket } from "../ws/connection";
import type { FileId, WorkspaceId } from "../ws/messages";

export const REMOTE_AWARENESS_ORIGIN = Symbol("remote-awareness");

export interface PresenceUser {
  id: string;
  name: string;
  color: string;
  colorLight: string;
}

export interface DocumentPresence {
  user?: PresenceUser;
  cursor?: unknown;
  schemaVersion?: 1;
}

const COLORS = ["#e06c75", "#61afef", "#98c379", "#c678dd", "#e5c07b", "#56b6c2"];

function anonymousUser(): PresenceUser {
  const fallback = { id: String(socket.clientId), name: "Anonymous", color: COLORS[0], colorLight: `${COLORS[0]}33` };
  if (typeof window === "undefined") return fallback;
  try {
    const key = "forge.presence.profile.v1";
    const stored = window.localStorage.getItem(key);
    if (stored) {
      const value = JSON.parse(stored) as Partial<PresenceUser>;
      if (typeof value.id === "string" && typeof value.name === "string" && typeof value.color === "string") {
        return { id: value.id.slice(0, 128), name: value.name.slice(0, 64), color: value.color, colorLight: value.colorLight ?? `${value.color}33` };
      }
    }
    const id = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    const color = COLORS[Math.abs(hash(id)) % COLORS.length];
    const profile = { id, name: `Guest ${id.slice(0, 4)}`, color, colorLight: `${color}33` };
    window.localStorage.setItem(key, JSON.stringify(profile));
    return profile;
  } catch {
    return fallback;
  }
}

function hash(value: string): number {
  let result = 0;
  for (let i = 0; i < value.length; i++) result = ((result << 5) - result + value.charCodeAt(i)) | 0;
  return result;
}

export function installAwarenessTransport(
  awareness: Awareness,
  identity: () => { workspaceId: WorkspaceId; fileId: FileId },
): () => void {
  awareness.setLocalState(null);
  const onUpdate = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
    if (origin === REMOTE_AWARENESS_ORIGIN) return;
    const clients = [...added, ...updated, ...removed];
    if (clients.length === 0 || !clients.includes(awareness.clientID)) return;
    const { workspaceId, fileId } = identity();
    socket.send({ kind: "AwarenessUpdate", workspace_id: workspaceId, file_id: fileId, payload: Array.from(encodeAwarenessUpdate(awareness, clients)) });
  };
  awareness.on("update", onUpdate);
  return () => awareness.off("update", onUpdate);
}

export function setAwarenessVisible(awareness: Awareness, visible: boolean): void {
  if (!visible) {
    if (awareness.getLocalState() !== null) awareness.setLocalState(null);
    return;
  }
  if (awareness.getLocalState() === null) awareness.setLocalState({ user: anonymousUser(), schemaVersion: 1 });
}

export function applyRemoteAwareness(awareness: Awareness, payload: number[]): void {
  applyAwarenessUpdate(awareness, new Uint8Array(payload), REMOTE_AWARENESS_ORIGIN);
}

export function clearRemoteAwareness(awareness: Awareness): void {
  const clients = [...awareness.getStates().keys()].filter((client) => client !== awareness.clientID);
  if (clients.length) removeAwarenessStates(awareness, clients, REMOTE_AWARENESS_ORIGIN);
}

