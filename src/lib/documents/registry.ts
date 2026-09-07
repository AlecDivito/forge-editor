import { socket } from '../ws/connection';
import { FileId, WorkspaceId } from '../ws/messages';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';

export type DocKey = `${string}:${string}`;

function keyOf(workspaceId: WorkspaceId, fileId: FileId): DocKey {
    return `${workspaceId}:${fileId}`;
}

export interface DocumentKeyParts {
    workspace: WorkspaceId
    fileId: FileId
}

export interface DocEntry {
    ydoc: Y.Doc;
    awareness: Awareness;
    refCount: number;
    unsubscribeSocket?: () => void;
}

const documents = new Map<DocKey, DocEntry>();

export function acquireDocument(workspaceId: WorkspaceId, fileId: FileId): DocEntry {
    const key = keyOf(workspaceId, fileId);
    let entry = documents.get(key);

    if (!entry) {
        const ydoc = new Y.Doc();
        const awareness = new Awareness(ydoc);
        entry = { ydoc, awareness, refCount: 0 };
        documents.set(key, entry);

        socket.send({ kind: 'DocSubscribe', workspace_id: workspaceId, file_id: fileId });

        const unsub = socket.subscribe((msg) => {
            if (msg.kind === 'DocSync' && msg.file_id === fileId) {
                Y.applyUpdate(ydoc, new Uint8Array(msg.update), 'remote');
            }
            if (msg.kind === 'DocUpdate' && msg.file_id === fileId && msg.origin !== socket.clientId) {
                Y.applyUpdate(ydoc, new Uint8Array(msg.update), 'remote');
            }
        });

        ydoc.on('update', (update, origin) => {
            if (origin === 'remote') return;
            socket.send({ kind: 'DocUpdate', workspace_id: workspaceId, file_id: fileId, update: Array.from(update) });
        });

        entry.unsubscribeSocket = unsub;
    }

    entry.refCount++;
    return entry;
}

export function releaseDocument(workspaceId: WorkspaceId, fileId: FileId) {
    const key = keyOf(workspaceId, fileId);
    const entry = documents.get(key);
    if (!entry) return;

    if (--entry.refCount === 0) {
        socket.send({ kind: 'DocUnsubscribe', workspace_id: workspaceId, file_id: fileId });
        entry.unsubscribeSocket?.();
        entry.ydoc.destroy();
        documents.delete(key);
    }
}