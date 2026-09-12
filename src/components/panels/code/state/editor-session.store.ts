import {
  getDocumentLifecycle,
  remapPathPrefix,
} from "@/lib/documents/registry";
import { FileId, FsEntryType, TerminalId, WorkspaceId } from "@/lib/ws/messages";
import { create } from "zustand";

interface BasePanelDescriptor {
  id: string;
  workspace: WorkspaceId;
}

export interface CodePanelDescriptor extends BasePanelDescriptor {
  kind: "code";
  fileId: FileId;
}

export interface TerminalPanelDescriptor extends BasePanelDescriptor {
  kind: "terminal";
  terminalId: TerminalId;
}

export type PanelDescriptor = CodePanelDescriptor | TerminalPanelDescriptor;

export interface EditorSessionState {
  panelsById: Record<string, PanelDescriptor>;
  panelOrder: string[];
  activePanelId: string | null;
  pendingClosePanelId: string | null;

  openFile: (workspace: WorkspaceId, fileId: FileId) => string;
  closePanel: (panelId: string) => void;
  requestClose: (panelId: string) => void;
  cancelClose: () => void;
  setActivePanel: (panelId: string | null) => void;
  remapPath: (workspace: WorkspaceId, from: FileId, to: FileId, entryType: FsEntryType) => void;
}

export const selectPanels = (state: EditorSessionState): PanelDescriptor[] =>
  state.panelOrder.flatMap((id) => {
    const panel = state.panelsById[id];
    return panel ? [panel] : [];
  });

export const selectActivePanel = (state: EditorSessionState): PanelDescriptor | undefined =>
  state.activePanelId ? state.panelsById[state.activePanelId] : undefined;

export const useEditorSessionStore = create<EditorSessionState>((set, get) => ({
  panelsById: {},
  panelOrder: [],
  activePanelId: null,
  pendingClosePanelId: null,

  openFile: (workspace, fileId) => {
    const state = get();
    const existingId = state.panelOrder.find((id) => {
      const panel = state.panelsById[id];
      return panel?.kind === "code" && panel.workspace === workspace && panel.fileId === fileId;
    });
    if (existingId) return existingId;

    const panel: PanelDescriptor = {
      id: crypto.randomUUID(),
      kind: "code",
      workspace,
      fileId,
    };
    set((current) => ({
      panelsById: { ...current.panelsById, [panel.id]: panel },
      panelOrder: [...current.panelOrder, panel.id],
    }));
    return panel.id;
  },

  closePanel: (panelId) => set((state) => {
    if (!state.panelsById[panelId]) return state;
    const panelsById = { ...state.panelsById };
    delete panelsById[panelId];
    return {
      panelsById,
      panelOrder: state.panelOrder.filter((id) => id !== panelId),
      activePanelId: state.activePanelId === panelId ? null : state.activePanelId,
      pendingClosePanelId: state.pendingClosePanelId === panelId ? null : state.pendingClosePanelId,
    };
  }),

  requestClose: (panelId) => {
    const panel = get().panelsById[panelId];
    if (!panel) return;
    if (panel.kind !== "code") {
      get().closePanel(panelId);
      return;
    }

    const lifecycle = getDocumentLifecycle(panel.workspace, panel.fileId);
    const needsConfirmation = lifecycle !== undefined &&
      (lifecycle.dirty || lifecycle.phase === "pending" || lifecycle.phase === "saving" ||
        lifecycle.phase === "save_error" || lifecycle.phase === "offline" || lifecycle.phase === "deleted");
    if (!needsConfirmation) {
      get().closePanel(panelId);
      return;
    }
    set({ pendingClosePanelId: panelId });
  },

  cancelClose: () => set({ pendingClosePanelId: null }),
  setActivePanel: (activePanelId) => set({ activePanelId }),

  remapPath: (workspace, from, to, entryType) => set((state) => {
    let changed = false;
    const panelsById = Object.fromEntries(Object.entries(state.panelsById).map(([id, panel]) => {
      if (panel.kind !== "code" || panel.workspace !== workspace) {
        return [id, panel];
      }
      const nextFileId = entryType === FsEntryType.Directory
        ? remapPathPrefix(from, to, panel.fileId)
        : panel.fileId === from ? to : undefined;
      if (nextFileId === undefined) return [id, panel];
      changed = true;
      return [id, { ...panel, fileId: nextFileId as FileId }];
    }));
    return changed ? { panelsById } : state;
  }),
}));
