import { DocKey, pathIsAffected, remapPathPrefix } from "@/lib/documents/registry";
import { FileId, FsEntryType, LspDiagnostic, WorkspaceId } from "@/lib/ws/messages";
import { create } from "zustand";

export const documentKey = (workspace: WorkspaceId, fileId: FileId): DocKey =>
  `${workspace}:${fileId}` as DocKey;

interface DiagnosticsState {
  byDocument: Record<DocKey, LspDiagnostic[]>;
  staleKeys: Record<DocKey, true>;
  publish: (workspace: WorkspaceId, fileId: FileId, diagnostics: LspDiagnostic[]) => void;
  remapPath: (workspace: WorkspaceId, from: FileId, to: FileId, entryType: FsEntryType) => void;
  removePath: (workspace: WorkspaceId, path: FileId, entryType: FsEntryType) => void;
}

export const emptyDiagnostics: LspDiagnostic[] = [];

function parseKey(key: string): { workspace: string; fileId: string } | undefined {
  const separator = key.indexOf(":");
  if (separator < 0) return undefined;
  return { workspace: key.slice(0, separator), fileId: key.slice(separator + 1) };
}

export const useDiagnosticsStore = create<DiagnosticsState>((set) => ({
  byDocument: {},
  staleKeys: {},

  publish: (workspace, fileId, diagnostics) => set((state) => {
    const key = documentKey(workspace, fileId);
    if (state.staleKeys[key]) return state;
    return { byDocument: { ...state.byDocument, [key]: diagnostics } };
  }),

  remapPath: (workspace, from, to, entryType) => set((state) => {
    const byDocument = { ...state.byDocument };
    const staleKeys = { ...state.staleKeys };
    let changed = false;

    for (const [key, diagnostics] of Object.entries(state.byDocument)) {
      const parts = parseKey(key);
      if (!parts || parts.workspace !== workspace) continue;
      const affected = entryType === FsEntryType.Directory
        ? pathIsAffected(from, parts.fileId)
        : parts.fileId === from;
      if (!affected) continue;

      const nextFileId = entryType === FsEntryType.Directory
        ? remapPathPrefix(from, to, parts.fileId)
        : to;
      if (nextFileId === undefined) continue;
      const nextKey = documentKey(workspace, nextFileId as FileId);
      if (byDocument[nextKey] === undefined) byDocument[nextKey] = diagnostics;
      delete byDocument[key as DocKey];
      staleKeys[key as DocKey] = true;
      changed = true;
    }
    return changed ? { byDocument, staleKeys } : state;
  }),

  removePath: (workspace, path, entryType) => set((state) => {
    const byDocument = { ...state.byDocument };
    let changed = false;
    for (const key of Object.keys(byDocument)) {
      const parts = parseKey(key);
      if (!parts || parts.workspace !== workspace) continue;
      const affected = entryType === FsEntryType.Directory
        ? pathIsAffected(path, parts.fileId)
        : parts.fileId === path;
      if (!affected) continue;
      delete byDocument[key as DocKey];
      changed = true;
    }
    return changed ? { byDocument } : state;
  }),
}));
