import { socket } from '../ws/connection';
import { FileId, FsEntryType, PersistencePhase, ServerMessage, WorkspaceId } from '../ws/messages';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { applyRemoteAwareness, clearRemoteAwareness, installAwarenessTransport } from './awareness';

// -----------------------------------------------------------------------------
// Public types
// -----------------------------------------------------------------------------

export type DocKey = `${string}:${string}`;
export type FilesystemEvent = Extract<ServerMessage, { kind: 'FsRenamed' | 'FsDeleted' }>;
export type DocumentLifecyclePhase =
    | 'loading'
    | 'clean'
    | 'pending'
    | 'saving'
    | 'save_error'
    | 'offline'
    | 'deleted';

export interface DocumentKeyParts {
    workspace: WorkspaceId;
    fileId: FileId;
}

export interface DocumentLifecycle {
    phase: DocumentLifecyclePhase;
    dirty: boolean;
    synchronized: boolean;
    revision?: number;
    persistedRevision?: number;
    error?: string;
}

export interface DocEntry {
    workspaceId: WorkspaceId;
    fileId: FileId;
    ydoc: Y.Doc;
    awareness: Awareness;
    refCount: number;
    unsubscribeSocket?: () => void;
    unsubscribeAwareness?: () => void;
    synchronized: boolean;
    syncingGeneration?: number;
    revision?: number;
    persistedRevision?: number;
    /** Local edits are tracked separately from server revisions. A server
     * acknowledgement must never clear a newer local edit. */
    localChangeSequence: number;
    acknowledgedLocalSequence: number;
    pendingLocalUpdates: PendingLocalUpdate[];
    localDirty: boolean;
    phase: DocumentLifecyclePhase;
    lifecycle: DocumentLifecycle;
    error?: string;
    saveTargetSequence?: number;
    /** Incremented whenever the filesystem location changes. */
    pathEpoch: number;
    disposeScheduled?: boolean;
}

// -----------------------------------------------------------------------------
// Internal types
// -----------------------------------------------------------------------------

interface PendingLocalUpdate {
    payload: number[];
    sequence: number;
}

type DocumentListener = () => void;
type FilesystemListener = (event: FilesystemEvent) => void;

// -----------------------------------------------------------------------------
// Module state
// -----------------------------------------------------------------------------

const documents = new Map<DocKey, DocEntry>();
const documentListeners = new Map<DocKey, Set<DocumentListener>>();
/** React effects can release using the path captured before a rename. */
const releaseAliases = new Map<DocKey, DocEntry>();
const registryListeners = new Set<DocumentListener>();
const filesystemListeners = new Set<FilesystemListener>();

let connectionSubscriptionInstalled = false;
let filesystemSubscriptionInstalled = false;

// -----------------------------------------------------------------------------
// Identity and path helpers
// -----------------------------------------------------------------------------

function keyOf(workspaceId: WorkspaceId, fileId: FileId): DocKey {
    return `${workspaceId}:${fileId}`;
}

function keyOfEntry(entry: Pick<DocEntry, 'workspaceId' | 'fileId'>): DocKey {
    return keyOf(entry.workspaceId, entry.fileId);
}

/** True only for a path itself or a complete path-segment descendant. */
export function pathIsAffected(root: string, candidate: string): boolean {
    const normalizedRoot = root.replace(/\\/g, '/').replace(/\/$/, '') || '/';
    const normalizedCandidate = candidate.replace(/\\/g, '/');
    return normalizedCandidate === normalizedRoot ||
        (normalizedRoot === '/' ? normalizedCandidate.startsWith('/') :
            normalizedCandidate.startsWith(`${normalizedRoot}/`));
}

/** Replace a path prefix without treating `src/a` as a parent of `src/abc`. */
export function remapPathPrefix(from: string, to: string, candidate: string): string | undefined {
    if (!pathIsAffected(from, candidate)) return undefined;
    const normalizedFrom = from.replace(/\\/g, '/').replace(/\/$/, '') || '/';
    const normalizedTo = to.replace(/\\/g, '/').replace(/\/$/, '') || '/';
    if (candidate.replace(/\\/g, '/') === normalizedFrom) return normalizedTo;
    const suffix = candidate.replace(/\\/g, '/').slice(normalizedFrom.length);
    return normalizedTo === '/' ? `/${suffix.replace(/^\//, '')}` : `${normalizedTo}${suffix}`;
}

// -----------------------------------------------------------------------------
// Lifecycle and synchronization helpers
// -----------------------------------------------------------------------------

function hasRevisionDirty(entry: DocEntry): boolean {
    return entry.revision !== undefined &&
        entry.persistedRevision !== undefined &&
        entry.revision !== entry.persistedRevision;
}

function hasContentDirty(entry: DocEntry): boolean {
    return entry.localDirty || hasRevisionDirty(entry);
}

function samePayload(left: number[], right: number[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

/** State-vector coverage is the structural empty-delta test. Yjs encodes an
 * empty update as [0, 0], so checking the encoded update's byte length is not
 * sufficient (and a server vector may also contain unrelated remote clients). */
export function stateVectorCoversDocument(doc: Y.Doc, encodedStateVector: number[] | Uint8Array): boolean {
    const local = Y.decodeStateVector(Y.encodeStateVector(doc));
    const server = Y.decodeStateVector(new Uint8Array(encodedStateVector));
    for (const [client, clock] of local) {
        if ((server.get(client) ?? 0) < clock) return false;
    }
    return true;
}

function acknowledgeThrough(entry: DocEntry, sequence: number): void {
    entry.acknowledgedLocalSequence = Math.max(entry.acknowledgedLocalSequence, sequence);
    entry.pendingLocalUpdates = entry.pendingLocalUpdates.filter(
        (pending) => pending.sequence > entry.acknowledgedLocalSequence,
    );
}

function trackLocalPayload(entry: DocEntry, payload: number[], sequence: number): void {
    if (payload.length === 0) return;
    entry.pendingLocalUpdates.push({ payload, sequence });
}

/** Consume an echoed update from the server without applying it a second time. */
export function acknowledgeLocalUpdate(entry: DocEntry, payload: number[]): boolean {
    const index = entry.pendingLocalUpdates.findIndex((pending) => samePayload(pending.payload, payload));
    if (index < 0) return false;
    const [pending] = entry.pendingLocalUpdates.splice(index, 1);
    acknowledgeThrough(entry, pending.sequence);
    notify(entry);
    return true;
}

function isDirty(entry: DocEntry): boolean {
    return hasContentDirty(entry) ||
        entry.phase === 'pending' || entry.phase === 'saving' ||
        entry.phase === 'save_error' || entry.phase === 'offline';
}

function notify(entry: DocEntry): void {
    documentListeners.get(keyOfEntry(entry))?.forEach((listener) => listener());
    registryListeners.forEach((listener) => listener());
}

function findCurrentEntry(workspaceId: WorkspaceId, fileId: FileId): DocEntry | undefined {
    return documents.get(keyOf(workspaceId, fileId));
}

function findEntryForRelease(workspaceId: WorkspaceId, fileId: FileId): DocEntry | undefined {
    return findCurrentEntry(workspaceId, fileId) ?? releaseAliases.get(keyOf(workspaceId, fileId));
}

function publish(entry: DocEntry, phase: DocumentLifecyclePhase = entry.phase, error?: string): void {
    entry.phase = phase;
    entry.error = error;
    entry.lifecycle = {
        phase,
        dirty: isDirty({ ...entry, phase }),
        synchronized: entry.synchronized,
        revision: entry.revision,
        persistedRevision: entry.persistedRevision,
        ...(error ? { error } : {}),
    };
    notify(entry);
    maybeDispose(entry);
}

function reconcileServerState(entry: DocEntry, serverPhase?: PersistencePhase, error?: string): void {
    if (entry.phase === 'deleted' && serverPhase !== PersistencePhase.Deleted) return;
    if (serverPhase === PersistencePhase.Deleted) {
        publish(entry, 'deleted', error);
        return;
    }

    if (serverPhase === PersistencePhase.SaveError) {
        publish(entry, 'save_error', error);
        return;
    }

    if (serverPhase === PersistencePhase.Saving) {
        publish(entry, 'saving', error);
        return;
    }

    if (serverPhase === PersistencePhase.Clean) {
        if (entry.localDirty &&
            entry.acknowledgedLocalSequence >= entry.localChangeSequence &&
            !hasRevisionDirty(entry)) {
            entry.localDirty = false;
        }
        if (hasContentDirty(entry)) {
            publish(entry, socket.status.kind === 'open' ? 'pending' : 'offline', error);
        } else if (entry.synchronized) {
            publish(entry, 'clean');
        }
        return;
    }

    if (isDirty(entry)) {
        publish(entry, socket.status.kind === 'open' ? 'pending' : 'offline', error);
    } else if (entry.synchronized) {
        publish(entry, 'clean');
    }
}

function maybeDispose(entry: DocEntry): void {
    if (entry.refCount !== 0 || isDirty(entry) || (entry.phase === 'deleted' && entry.lifecycle.dirty)) return;
    // React cleans up the old useDocument effect before acquiring the same
    // entry under its new path. Give that paired cleanup/reacquire cycle one
    // microtask so the preserved Y.Doc cannot be disposed in between.
    if (!entry.disposeScheduled && Array.from(releaseAliases.values()).some((aliased) => aliased === entry)) {
        entry.disposeScheduled = true;
        queueMicrotask(() => {
            entry.disposeScheduled = false;
            for (const [alias, aliasedEntry] of releaseAliases) {
                if (aliasedEntry === entry) releaseAliases.delete(alias);
            }
            maybeDispose(entry);
        });
        return;
    }
    const key = keyOfEntry(entry);
    if (documents.get(key) !== entry) return;
    socket.send({ kind: 'DocUnsubscribe', workspace_id: entry.workspaceId, file_id: entry.fileId });
    if (entry.awareness.getLocalState() !== null) entry.awareness.setLocalState(null);
    entry.unsubscribeAwareness?.();
    entry.unsubscribeSocket?.();
    entry.ydoc.destroy();
    documents.delete(key);
    for (const [alias, aliasedEntry] of releaseAliases) {
        if (aliasedEntry === entry) releaseAliases.delete(alias);
    }
    documentListeners.delete(key);
    registryListeners.forEach((listener) => listener());
}

// -----------------------------------------------------------------------------
// Queries and subscriptions
// -----------------------------------------------------------------------------

export function subscribeDocument(workspaceId: WorkspaceId, fileId: FileId, listener: DocumentListener): () => void {
    const key = keyOf(workspaceId, fileId);
    const listeners = documentListeners.get(key) ?? new Set<DocumentListener>();
    listeners.add(listener);
    documentListeners.set(key, listeners);
    return () => {
        // Search all keys because the document may have been renamed while a
        // React effect retained the listener created for its old path.
        for (const [listenerKey, listenerSet] of documentListeners) {
            listenerSet.delete(listener);
            if (listenerSet.size === 0) documentListeners.delete(listenerKey);
        }
    };
}

export function subscribeDocuments(listener: DocumentListener): () => void {
    registryListeners.add(listener);
    return () => registryListeners.delete(listener);
}

export function getDocumentLifecycle(workspaceId: WorkspaceId, fileId: FileId): DocumentLifecycle | undefined {
    return documents.get(keyOf(workspaceId, fileId))?.lifecycle;
}

export function getDocumentEntry(workspaceId: WorkspaceId, fileId: FileId): DocEntry | undefined {
    return findCurrentEntry(workspaceId, fileId);
}

export function subscribeFilesystemEvents(listener: FilesystemListener): () => void {
    filesystemListeners.add(listener);
    return () => filesystemListeners.delete(listener);
}

export function hasUnsavedDocuments(): boolean {
    return Array.from(documents.values()).some(isDirty);
}

// -----------------------------------------------------------------------------
// Server synchronization
// -----------------------------------------------------------------------------

/** Apply an authoritative server lifecycle snapshot. Kept public so the
 * acknowledgement race can be tested without mocking WebSocket internals. */
export function applyDocumentState(
    entry: DocEntry,
    revision: number,
    persistedRevision: number,
    phase: PersistencePhase,
    error?: string,
): void {
    entry.revision = revision;
    entry.persistedRevision = persistedRevision;
    reconcileServerState(entry, phase, error);
}

function syncEntry(entry: DocEntry, generation: number): void {
    if (entry.syncingGeneration === generation || !socket.status || socket.status.kind !== 'open') return;
    entry.syncingGeneration = generation;
    entry.synchronized = false;
    if (!isDirty(entry)) publish(entry, 'loading');
    const sent = socket.send({
        kind: 'DocSyncStep1',
        workspace_id: entry.workspaceId,
        file_id: entry.fileId,
        state_vector: Array.from(Y.encodeStateVector(entry.ydoc)),
    });
    if (!sent) entry.syncingGeneration = undefined;
}

// -----------------------------------------------------------------------------
// Filesystem reconciliation
// -----------------------------------------------------------------------------

/** Move retained browser documents in place, preserving Y.Doc and all local
 * lifecycle state. The old key remains a release-only alias until its old
 * React consumer is cleaned up. */
export function remapPath(
    workspaceId: WorkspaceId,
    from: FileId,
    to: FileId,
    entryType: FsEntryType,
): number {
    const affected = Array.from(documents.values()).filter((entry) =>
        entry.workspaceId === workspaceId &&
        (entryType === FsEntryType.Directory ? pathIsAffected(from, entry.fileId) : entry.fileId === from),
    );
    const moves = affected.map((entry) => ({
        entry,
        oldKey: keyOfEntry(entry),
        newFileId: (entryType === FsEntryType.Directory
            ? remapPathPrefix(from, to, entry.fileId)
            : to) as FileId,
    }));

    // Remove all old keys first so a multi-entry directory move cannot make a
    // descendant collide with another old key during the commit.
    for (const move of moves) {
        if (documents.get(move.oldKey) === move.entry) documents.delete(move.oldKey);
    }
    for (const move of moves) {
        move.entry.fileId = move.newFileId;
        move.entry.pathEpoch++;
        move.entry.syncingGeneration = undefined;
        releaseAliases.set(move.oldKey, move.entry);
        const nextKey = keyOfEntry(move.entry);
        const listeners = documentListeners.get(move.oldKey);
        if (listeners) {
            documentListeners.delete(move.oldKey);
            documentListeners.set(nextKey, listeners);
        }
        documents.set(nextKey, move.entry);
    }
    for (const move of moves) {
        notify(move.entry);
        if (socket.status.kind === 'open') syncEntry(move.entry, socket.generation);
    }
    if (moves.length > 0) registryListeners.forEach((listener) => listener());
    return moves.length;
}

/** Mark deleted documents without releasing their browser-owned Y.Doc. */
export function markDeletedPath(
    workspaceId: WorkspaceId,
    path: FileId,
    entryType: FsEntryType,
): number {
    const affected = Array.from(documents.values()).filter((entry) =>
        entry.workspaceId === workspaceId &&
        (entryType === FsEntryType.Directory ? pathIsAffected(path, entry.fileId) : entry.fileId === path),
    );
    for (const entry of affected) {
        entry.syncingGeneration = undefined;
        publish(entry, 'deleted', entry.error);
    }
    return affected.length;
}

// -----------------------------------------------------------------------------
// Socket subscriptions
// -----------------------------------------------------------------------------

function installFilesystemSubscription(): void {
    if (filesystemSubscriptionInstalled) return;
    filesystemSubscriptionInstalled = true;
    socket.subscribe((msg) => {
        if (msg.kind === 'FsRenamed') {
            remapPath(msg.workspace_id, msg.from as FileId, msg.to as FileId, msg.entry_type);
            filesystemListeners.forEach((listener) => listener(msg));
        } else if (msg.kind === 'FsDeleted') {
            markDeletedPath(msg.workspace_id, msg.path as FileId, msg.entry_type);
            filesystemListeners.forEach((listener) => listener(msg));
        }
    });
}

function installConnectionSubscription() {
    if (connectionSubscriptionInstalled) return;
    connectionSubscriptionInstalled = true;
    socket.subscribeConnection((generation) => {
        documents.forEach((entry) => {
            clearRemoteAwareness(entry.awareness);
            syncEntry(entry, generation);
        });
    });
}

// -----------------------------------------------------------------------------
// Document ownership
// -----------------------------------------------------------------------------

export function acquireDocument(workspaceId: WorkspaceId, fileId: FileId): DocEntry {
    const key = keyOf(workspaceId, fileId);
    let entry = documents.get(key);

    if (!entry) {
        const ydoc = new Y.Doc();
        const awareness = new Awareness(ydoc);
        entry = {
            workspaceId,
            fileId,
            ydoc,
            awareness,
            refCount: 0,
            synchronized: false,
            localChangeSequence: 0,
            acknowledgedLocalSequence: 0,
            pendingLocalUpdates: [],
            localDirty: false,
            phase: 'loading',
            pathEpoch: 0,
            lifecycle: {
                phase: 'loading',
                dirty: false,
                synchronized: false,
            },
        };
        documents.set(key, entry);
        entry.unsubscribeAwareness = installAwarenessTransport(awareness, () => ({
            workspaceId: entry!.workspaceId,
            fileId: entry!.fileId,
        }));
        notify(entry);

        const documentEntry = entry;
        const unsub = socket.subscribe((msg) => {
            // A delete is authoritative. Late document traffic from the
            // previous actor must not resurrect or mutate a deleted entry.
            if (documentEntry.phase === 'deleted' && msg.kind !== 'DocState') return;
            if ((msg.kind === 'DocSync' || msg.kind === 'DocSyncStep2') &&
                msg.workspace_id === documentEntry.workspaceId && msg.file_id === documentEntry.fileId) {
                Y.applyUpdate(documentEntry.ydoc, new Uint8Array(msg.update), 'remote');
                if (msg.kind === 'DocSyncStep2') {
                    // The server vector describes the state included in its
                    // response. Sending our delta makes offline/client-only
                    // edits converge without replaying stale socket messages.
                    try {
                        const localDelta = Y.encodeStateAsUpdate(documentEntry.ydoc, new Uint8Array(msg.state_vector));
                        const localDeltaArray = Array.from(localDelta);
                        const serverCoversLocalState = stateVectorCoversDocument(documentEntry.ydoc, msg.state_vector);
                        if (!serverCoversLocalState) {
                            trackLocalPayload(documentEntry, localDeltaArray, documentEntry.localChangeSequence);
                        } else {
                            // The returned state vector already covers the
                            // local Y.Doc. It is an acknowledgement of all
                            // edits represented by this synchronization.
                            acknowledgeThrough(documentEntry, documentEntry.localChangeSequence);
                        }
                        const sent = socket.send({
                            kind: 'DocSyncStep2',
                            workspace_id: documentEntry.workspaceId,
                            file_id: documentEntry.fileId,
                            update: localDeltaArray,
                        });
                        if (sent) {
                            documentEntry.synchronized = true;
                            documentEntry.syncingGeneration = socket.generation;
                            reconcileServerState(documentEntry);
                            const localPresence = documentEntry.awareness.getLocalState();
                            if (localPresence !== null) documentEntry.awareness.setLocalState(localPresence);
                        }
                    } catch {
                        documentEntry.syncingGeneration = undefined;
                    }
                }
            }
            if (msg.kind === 'DocUpdate' && msg.workspace_id === documentEntry.workspaceId && msg.file_id === documentEntry.fileId) {
                if (msg.origin === socket.clientId) {
                    acknowledgeLocalUpdate(documentEntry, msg.update);
                } else {
                    Y.applyUpdate(documentEntry.ydoc, new Uint8Array(msg.update), 'remote');
                }
            }
            if (msg.kind === 'DocState' && msg.workspace_id === documentEntry.workspaceId && msg.file_id === documentEntry.fileId) {
                applyDocumentState(documentEntry, msg.revision, msg.persisted_revision, msg.phase, msg.error);
            }
            if ((msg.kind === 'AwarenessUpdate' || msg.kind === 'AwarenessSnapshot') &&
                msg.workspace_id === documentEntry.workspaceId && msg.file_id === documentEntry.fileId &&
                (msg.kind === 'AwarenessSnapshot' || msg.client_id !== socket.clientId)) {
                applyRemoteAwareness(documentEntry.awareness, msg.payload);
                notify(documentEntry);
            }
        });

        documentEntry.ydoc.on('update', (update, origin) => {
            if (origin === 'remote') return;
            documentEntry.localChangeSequence++;
            documentEntry.localDirty = true;
            const localSequence = documentEntry.localChangeSequence;
            const payload = Array.from(update);
            trackLocalPayload(documentEntry, payload, localSequence);
            if (documentEntry.phase !== 'deleted') {
                publish(documentEntry, socket.status.kind === 'open' ? 'pending' : 'offline');
                socket.send({ kind: 'DocUpdate', workspace_id: documentEntry.workspaceId, file_id: documentEntry.fileId, update: payload });
            }
        });

        entry.unsubscribeSocket = unsub;
    }

    entry.refCount++;
    installConnectionSubscription();
    if (socket.status.kind === 'open') syncEntry(entry, socket.generation);
    return entry;
}

/** Snapshot the documents currently retained by the browser registry. */
export function listOpenDocuments(): Array<{ workspaceId: WorkspaceId; fileId: FileId; entry: DocEntry }> {
    return Array.from(documents.values()).map((entry) => ({
        workspaceId: entry.workspaceId,
        fileId: entry.fileId,
        entry,
    }));
}

export function releaseDocument(workspaceId: WorkspaceId, fileId: FileId) {
    const entry = findEntryForRelease(workspaceId, fileId);
    if (!entry) return;

    releaseDocumentEntry(entry);
}

/** Release by identity so a React effect captured before a rename cannot
 * accidentally decrement a newly opened document that later reused the old
 * path. */
export function releaseDocumentEntry(entry: DocEntry): void {
    if (!documents.has(keyOfEntry(entry)) && !Array.from(releaseAliases.values()).includes(entry)) return;

    entry.refCount = Math.max(0, entry.refCount - 1);
    if (entry.refCount === 0) maybeDispose(entry);
}

// -----------------------------------------------------------------------------
// Explicit persistence
// -----------------------------------------------------------------------------

/** Mark the beginning of an explicit save and preserve the local edit epoch. */
export function beginDocumentSave(workspaceId: WorkspaceId, fileId: FileId): number | undefined {
    const entry = documents.get(keyOf(workspaceId, fileId));
    if (!entry || entry.phase === 'deleted') return undefined;
    entry.saveTargetSequence = entry.localChangeSequence;
    publish(entry, socket.status.kind === 'open' ? 'saving' : 'offline', entry.error);
    return entry.saveTargetSequence;
}

export function finishDocumentSave(
    workspaceId: WorkspaceId,
    fileId: FileId,
    savedRevision: number,
    currentRevision: number,
    targetSequence: number,
): void {
    const entry = findEntryForRelease(workspaceId, fileId);
    if (!entry) return;
    finishDocumentSaveEntry(entry, savedRevision, currentRevision, targetSequence);
}

export function finishDocumentSaveEntry(
    entry: DocEntry,
    savedRevision: number,
    currentRevision: number,
    targetSequence: number,
): void {
    if (entry.phase === 'deleted') return;
    entry.revision = currentRevision;
    entry.persistedRevision = savedRevision;
    const hasNewerLocalEdit = entry.localChangeSequence !== targetSequence;
    if (!hasNewerLocalEdit && savedRevision === currentRevision) {
        acknowledgeThrough(entry, targetSequence);
        entry.localDirty = false;
        publish(entry, 'clean');
    } else if (savedRevision === currentRevision) {
        acknowledgeThrough(entry, targetSequence);
        reconcileServerState(entry);
    } else {
        reconcileServerState(entry);
    }
}

export function failDocumentSave(workspaceId: WorkspaceId, fileId: FileId, error: string): void {
    const entry = findEntryForRelease(workspaceId, fileId);
    if (entry) publish(entry, socket.status.kind === 'open' ? 'save_error' : 'offline', error);
}

export function failDocumentSaveEntry(entry: DocEntry, error: string): void {
    if (entry.phase === 'deleted') return;
    publish(entry, socket.status.kind === 'open' ? 'save_error' : 'offline', error);
}

// -----------------------------------------------------------------------------
// Module initialization
// -----------------------------------------------------------------------------

installConnectionSubscription();
installFilesystemSubscription();
socket.subscribeStatus(() => {
    const open = socket.status.kind === 'open';
    documents.forEach((entry) => {
        if (!open && isDirty(entry) && entry.phase !== 'deleted') publish(entry, 'offline', entry.error);
        else if (open && entry.phase === 'offline') publish(entry, 'pending', entry.error);
    });
});
