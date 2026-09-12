import {
    beginDocumentSave,
    finishDocumentSaveEntry,
    failDocumentSaveEntry,
    getDocumentLifecycle,
    getDocumentEntry,
    listOpenDocuments,
    remapPathPrefix,
    subscribeFilesystemEvents,
} from "./registry";
import { FsEntryType } from "../ws/messages";
import { socket } from "../ws/connection";
import { FileId, ServerMessage, WorkspaceId } from "../ws/messages";

export type SaveResult = Extract<ServerMessage, { kind: "DocSaveResult" }>;

const pendingSaves = new Map<string, Promise<SaveResult>>();

function saveKey(workspaceId: WorkspaceId, fileId: FileId): string {
    return `${workspaceId}\u0000${fileId}`;
}

// Keep same-document coalescing intact when the authoritative filesystem event
// arrives while a save request is in flight.
subscribeFilesystemEvents((event) => {
    if (event.kind !== 'FsRenamed') return;
    for (const [key, operation] of Array.from(pendingSaves)) {
        const separator = key.indexOf('\u0000');
        if (separator < 0 || key.slice(0, separator) !== event.workspace_id) continue;
        const fileId = key.slice(separator + 1);
        const nextFileId = event.entry_type === FsEntryType.Directory
            ? remapPathPrefix(event.from, event.to, fileId)
            : fileId === event.from ? event.to : undefined;
        if (nextFileId === undefined) continue;
        pendingSaves.delete(key);
        pendingSaves.set(saveKey(event.workspace_id, nextFileId as FileId), operation);
    }
});

/** Save one open document and await its server-side persistence result. */
export function saveDocument(workspaceId: WorkspaceId, fileId: FileId): Promise<SaveResult> {
    const key = saveKey(workspaceId, fileId);
    const existing = pendingSaves.get(key);
    if (existing) {
        // The socket manager coalesces same-document requests. If a caller
        // asks to save again while that request is active, wait for it and
        // issue one follow-up for any edit that landed in the meantime.
        return existing.then((result) => {
            const lifecycle = getDocumentLifecycle(workspaceId, fileId);
            return lifecycle?.dirty ? saveDocument(workspaceId, fileId) : result;
        });
    }

    const documentEntry = getDocumentEntry(workspaceId, fileId);
    const targetSequence = beginDocumentSave(workspaceId, fileId);
    if (targetSequence === undefined) {
        return Promise.reject(new Error(`Document is not open: ${fileId}`));
    }

    const operation = socket.saveDocument(workspaceId, fileId).then((result) => {
        finishDocumentSaveEntry(
            documentEntry!,
            result.saved_revision,
            result.current_revision,
            targetSequence,
        );
        if (result.error) throw new Error(result.error);
        return result;
    }).catch((error) => {
        failDocumentSaveEntry(documentEntry!, error instanceof Error ? error.message : String(error));
        throw error;
    });
    pendingSaves.set(key, operation);
    void operation.then(() => undefined, () => undefined).then(() => {
        for (const [pendingKey, pendingOperation] of pendingSaves) {
            if (pendingOperation === operation) pendingSaves.delete(pendingKey);
        }
    });
    return operation;
}

export interface SaveAllResult {
    results: SaveResult[];
    failures: Array<{ workspaceId: WorkspaceId; fileId: FileId; error: Error }>;
}

/**
 * Request saves for every document retained by the browser registry. The
 * server may cheaply acknowledge clean documents; collecting each outcome
 * lets the caller report partial failures without abandoning other saves.
 */
export async function saveAllOpenDocuments(): Promise<SaveAllResult> {
    const documents = listOpenDocuments().filter(({ entry }) => entry.lifecycle.dirty);
    const settled = await Promise.all(documents.map(async ({ workspaceId, fileId }) => {
        try {
            return { workspaceId, fileId, result: await saveDocument(workspaceId, fileId) };
        } catch (error) {
            return {
                workspaceId,
                fileId,
                error: error instanceof Error ? error : new Error(String(error)),
            };
        }
    }));

    const results: SaveResult[] = [];
    const failures: SaveAllResult["failures"] = [];
    for (const outcome of settled) {
        if ("result" in outcome && outcome.result !== undefined) results.push(outcome.result);
        else failures.push({ workspaceId: outcome.workspaceId, fileId: outcome.fileId, error: outcome.error });
    }
    return { results, failures };
}

export const saveAllDirtyDocuments = saveAllOpenDocuments;
