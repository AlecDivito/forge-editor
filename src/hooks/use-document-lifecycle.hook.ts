import { useSyncExternalStore } from 'react';
import {
    DocumentLifecycle,
    getDocumentLifecycle,
    subscribeDocument,
    subscribeDocuments,
} from '@/lib/documents/registry';
import { FileId, WorkspaceId } from '@/lib/ws/messages';

const loadingLifecycle: DocumentLifecycle = Object.freeze({
    phase: 'loading',
    dirty: false,
    synchronized: false,
});

/** Lifecycle state for a document tab. The registry owns the stable snapshot. */
export function useDocumentLifecycle(workspaceId?: WorkspaceId, fileId?: FileId): DocumentLifecycle {
    return useSyncExternalStore(
        (listener) => {
            if (workspaceId === undefined || fileId === undefined) return subscribeDocuments(listener);
            return subscribeDocument(workspaceId, fileId, listener);
        },
        () => (workspaceId === undefined || fileId === undefined
            ? loadingLifecycle
            : getDocumentLifecycle(workspaceId, fileId) ?? loadingLifecycle),
        () => loadingLifecycle,
    );
}

