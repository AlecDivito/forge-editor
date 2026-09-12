import {
    acquireDocument,
    acknowledgeLocalUpdate,
    applyDocumentState,
    getDocumentLifecycle,
    releaseDocument,
    markDeletedPath,
    remapPath,
    stateVectorCoversDocument,
} from '@/lib/documents/registry';
import { FileId, FsEntryType, PersistencePhase, WorkspaceId } from '@/lib/ws/messages';
import * as Y from 'yjs';

const workspace = 'lifecycle-test' as WorkspaceId;
const file = 'notes.txt' as FileId;

describe('document lifecycle', () => {
    it('detects an empty reconnect delta structurally', () => {
        const doc = new Y.Doc();
        const stateVector = Array.from(Y.encodeStateVector(doc));
        const emptyUpdate = Y.encodeStateAsUpdate(doc, new Uint8Array(stateVector));

        expect(emptyUpdate.length).toBeGreaterThan(0);
        expect(stateVectorCoversDocument(doc, stateVector)).toBe(true);

        doc.getText('content').insert(0, 'local');
        expect(stateVectorCoversDocument(doc, stateVector)).toBe(false);
    });

    it('clears autosaved local work after its echoed update is acknowledged', () => {
        const entry = acquireDocument(workspace, file);
        expect(getDocumentLifecycle(workspace, file)?.phase).toBe('loading');
        entry.synchronized = true;
        const updates: number[][] = [];
        entry.ydoc.on('update', (update) => updates.push(Array.from(update)));

        entry.ydoc.getText('content').insert(0, 'first');
        expect(getDocumentLifecycle(workspace, file)).toEqual(expect.objectContaining({
            phase: 'offline',
            dirty: true,
        }));
        expect(acknowledgeLocalUpdate(entry, updates[0])).toBe(true);
        applyDocumentState(entry, 1, 1, PersistencePhase.Clean);
        expect(getDocumentLifecycle(workspace, file)).toEqual(expect.objectContaining({
            phase: 'clean',
            dirty: false,
        }));
        releaseDocument(workspace, file);
    });

    it('does not let an older echoed update clear a newer local edit', () => {
        const entry = acquireDocument(workspace, file);
        entry.synchronized = true;
        const updates: number[][] = [];
        entry.ydoc.on('update', (update) => updates.push(Array.from(update)));

        entry.ydoc.getText('content').insert(0, 'first');
        entry.ydoc.getText('content').insert(5, ' second');
        expect(updates).toHaveLength(2);
        expect(acknowledgeLocalUpdate(entry, updates[0])).toBe(true);
        applyDocumentState(entry, 1, 1, PersistencePhase.Clean);
        expect(getDocumentLifecycle(workspace, file)).toEqual(expect.objectContaining({
            phase: 'offline',
            dirty: true,
        }));

        expect(acknowledgeLocalUpdate(entry, updates[1])).toBe(true);
        applyDocumentState(entry, 2, 2, PersistencePhase.Clean);
        expect(getDocumentLifecycle(workspace, file)).toEqual(expect.objectContaining({
            phase: 'clean',
            dirty: false,
        }));
        releaseDocument(workspace, file);
    });

    it('remaps an open file without replacing its Y.Doc or refcount', () => {
        const oldFile = '/src/notes.txt' as FileId;
        const newFile = '/archive/notes.txt' as FileId;
        const entry = acquireDocument(workspace, oldFile);
        acquireDocument(workspace, oldFile);
        entry.ydoc.getText('content').insert(0, 'keep this edit');

        expect(remapPath(workspace, oldFile, newFile, FsEntryType.File)).toBe(1);
        expect(acquireDocument(workspace, newFile)).toBe(entry);
        expect(entry.fileId).toBe(newFile);
        expect(entry.refCount).toBe(3);
        expect(entry.ydoc.getText('content').toString()).toBe('keep this edit');

        // Both React consumers may still clean up with the old captured key.
        releaseDocument(workspace, oldFile);
        releaseDocument(workspace, oldFile);
        expect(entry.refCount).toBe(1);
        releaseDocument(workspace, newFile);
    });

    it('remaps directory descendants by path segment, preserving identities', () => {
        const child = acquireDocument(workspace, '/src/app.ts' as FileId);
        const nested = acquireDocument(workspace, '/src/lib/index.ts' as FileId);
        const siblingPrefix = acquireDocument(workspace, '/src-old/app.ts' as FileId);

        expect(remapPath(workspace, '/src' as FileId, '/archive/src' as FileId, FsEntryType.Directory)).toBe(2);
        expect(acquireDocument(workspace, '/archive/src/app.ts' as FileId)).toBe(child);
        expect(acquireDocument(workspace, '/archive/src/lib/index.ts' as FileId)).toBe(nested);
        expect(acquireDocument(workspace, '/src-old/app.ts' as FileId)).toBe(siblingPrefix);

        releaseDocument(workspace, '/src/app.ts' as FileId);
        releaseDocument(workspace, '/src/lib/index.ts' as FileId);
        releaseDocument(workspace, '/src-old/app.ts' as FileId);
        releaseDocument(workspace, '/archive/src/app.ts' as FileId);
        releaseDocument(workspace, '/archive/src/lib/index.ts' as FileId);
        releaseDocument(workspace, '/src-old/app.ts' as FileId);
    });

    it('marks deleted documents without silently releasing their open view', () => {
        const deletedFile = '/deleted.txt' as FileId;
        const entry = acquireDocument(workspace, deletedFile);

        expect(markDeletedPath(workspace, deletedFile, FsEntryType.File)).toBe(1);
        expect(getDocumentLifecycle(workspace, deletedFile)).toEqual(expect.objectContaining({
            phase: 'deleted',
            dirty: false,
        }));
        expect(entry.refCount).toBe(1);

        releaseDocument(workspace, deletedFile);
        expect(getDocumentLifecycle(workspace, deletedFile)).toBeUndefined();
    });
});
