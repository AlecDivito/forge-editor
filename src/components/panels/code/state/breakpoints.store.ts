import { pathIsAffected, remapPathPrefix } from "@/lib/documents/registry";
import { FileId, FsEntryType, WorkspaceId } from "@/lib/ws/messages";
import { create } from "zustand";
import { documentKey } from "./diagnostics.store";

export interface Breakpoint {
  line: number;
}

export const emptyBreakpoints: readonly Breakpoint[] = [];

interface BreakpointState {
  byDocument: Record<string, readonly Breakpoint[]>;
  toggle: (workspace: WorkspaceId, fileId: FileId, line: number) => readonly Breakpoint[];
  set: (workspace: WorkspaceId, fileId: FileId, breakpoints: readonly Breakpoint[]) => void;
  remapPath: (workspace: WorkspaceId, from: FileId, to: FileId, entryType: FsEntryType) => void;
  removePath: (workspace: WorkspaceId, path: FileId, entryType: FsEntryType) => void;
}

function normalize(breakpoints: readonly Breakpoint[]): readonly Breakpoint[] {
  return [...new Set(breakpoints.map((breakpoint) => breakpoint.line).filter((line) => Number.isInteger(line) && line > 0))]
    .sort((left, right) => left - right)
    .map((line) => ({ line }));
}

export function getBreakpoints(workspace: WorkspaceId, fileId: FileId): readonly Breakpoint[] {
  return useBreakpointStore.getState().byDocument[documentKey(workspace, fileId)] ?? emptyBreakpoints;
}

export const useBreakpointStore = create<BreakpointState>((set, get) => ({
  byDocument: {},

  toggle: (workspace, fileId, line) => {
    const key = documentKey(workspace, fileId);
    const current = get().byDocument[key] ?? emptyBreakpoints;
    const next = current.some((breakpoint) => breakpoint.line === line)
      ? current.filter((breakpoint) => breakpoint.line !== line)
      : normalize([...current, { line }]);
    set((state) => ({ byDocument: { ...state.byDocument, [key]: next } }));
    return next;
  },

  set: (workspace, fileId, breakpoints) => {
    const key = documentKey(workspace, fileId);
    const next = normalize(breakpoints);
    set((state) => ({ byDocument: { ...state.byDocument, [key]: next } }));
  },

  remapPath: (workspace, from, to, entryType) =>
    set((state) => {
      const byDocument = { ...state.byDocument };
      let changed = false;
      for (const [key, breakpoints] of Object.entries(state.byDocument)) {
        const separator = key.indexOf(":");
        if (separator < 0 || key.slice(0, separator) !== workspace) continue;
        const fileId = key.slice(separator + 1);
        const affected = entryType === FsEntryType.Directory ? pathIsAffected(from, fileId) : fileId === from;
        if (!affected) continue;
        const nextFileId = entryType === FsEntryType.Directory ? remapPathPrefix(from, to, fileId) : to;
        if (nextFileId === undefined) continue;
        byDocument[documentKey(workspace, nextFileId as FileId)] ??= breakpoints;
        delete byDocument[key];
        changed = true;
      }
      return changed ? { byDocument } : state;
    }),

  removePath: (workspace, path, entryType) =>
    set((state) => {
      const byDocument = { ...state.byDocument };
      let changed = false;
      for (const key of Object.keys(byDocument)) {
        const separator = key.indexOf(":");
        if (separator < 0 || key.slice(0, separator) !== workspace) continue;
        const fileId = key.slice(separator + 1);
        const affected = entryType === FsEntryType.Directory ? pathIsAffected(path, fileId) : fileId === path;
        if (!affected) continue;
        delete byDocument[key];
        changed = true;
      }
      return changed ? { byDocument } : state;
    }),
}));
