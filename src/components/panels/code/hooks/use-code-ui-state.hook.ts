import { DocKey } from "@/lib/documents/registry";
import { FileId, LspDiagnostic, TerminalId, WorkspaceId } from "@/lib/ws/messages";
import { create } from "zustand";

export interface PanelDescriptor {
    id: string;             // dockview panel id (random) — NOT the same as fileId
    kind: 'code' | 'terminal';
    workspace: WorkspaceId;
    fileId?: FileId;        // doubles as the file's path — nothing else stored about it
    terminalId?: TerminalId;
}

export interface GroupDescriptor {
    id: string;
    panelIds: string[];
    activePanelId?: string;
}

interface UICodeState {
    openPanels: PanelDescriptor[];
    diagnostics: Record<DocKey, LspDiagnostic[]>;

    groups: Record<string, GroupDescriptor>;
    groupOrder: string[];
    activeGroupId: string | null;
    activePanelId: string | null;
    activeWorkspaceId: WorkspaceId | null;
    activeFileId: FileId | null;

    openFile: (workspace: WorkspaceId, fileId: FileId) => string; // returns panel id
    closeFile: (panelId: string) => void;
    setDiagnostics: (workspace: WorkspaceId, fileId: FileId, diagnostics: LspDiagnostic[]) => void;

    syncGroups: (groups: GroupDescriptor[], groupOrder: string[]) => void;
    setActivePanel: (panelId: string | null, groupId: string | null, activeWorkspaceId: WorkspaceId | null, activeFileId: FileId | null) => void;
}

export const useUICodeState = create<UICodeState>((set, get) => ({
    openPanels: [],
    diagnostics: {},
    groups: {},
    groupOrder: [],
    activeGroupId: null,
    activePanelId: null,
    activeWorkspaceId: null,
    activeFileId: null,

    openFile: (workspace, fileId) => {
        const existing = get().openPanels.find(
            (p) => p.workspace === workspace && p.fileId === fileId,
        );
        if (existing) return existing.id;

        const panel: PanelDescriptor = {
            id: crypto.randomUUID(),
            kind: 'code',
            workspace,
            fileId,
        };
        set((s) => ({ openPanels: [...s.openPanels, panel] }));
        return panel.id;
    },

    closeFile: (panelId) =>
        set((s) => ({
            openPanels: s.openPanels.filter((p) => p.id !== panelId),
            groups: Object.fromEntries(
                Object.entries(s.groups).map(([id, g]) => [
                    id,
                    { ...g, panelIds: g.panelIds.filter((pid) => pid !== panelId) },
                ]),
            ),
            activePanelId: s.activePanelId === panelId ? null : s.activePanelId,
        })),

    setDiagnostics: (workspace, fileId, diagnostics) =>
        set((s) => ({
            diagnostics: { ...s.diagnostics, [`${workspace}:${fileId}`]: diagnostics },
        })),

    syncGroups: (groups, groupOrder) =>
        set({
            groups: Object.fromEntries(groups.map((g) => [g.id, g])),
            groupOrder,
        }),

    setActivePanel: (panelId, groupId, activeWorkspaceId, activeFileId) =>
        set({ activePanelId: panelId, activeGroupId: groupId, activeWorkspaceId: activeWorkspaceId, activeFileId: activeFileId }),

}));

// --- Derived, not stored — recomputed from ids on read ---

function baseName(p: PanelDescriptor): string {
    return p.fileId?.split('/').pop() ?? 'untitled';
}

/**
 * Tab title. Disambiguates same-basename files by workspace id when they collide.
 * Pass `resolveWorkspaceName` if you have a friendlier label than the raw id
 * (e.g. from a workspaces registry) — falls back to the raw workspace id otherwise.
 */
export function titleFor(
    panel: PanelDescriptor,
    allPanels: PanelDescriptor[],
    resolveWorkspaceName: (workspace: WorkspaceId) => string = (w) => String(w),
): string {
    if (panel.kind === 'terminal') {
        return `Terminal ${panel.terminalId ?? ''}`.trim();
    }
    const name = baseName(panel);
    const collides = allPanels.some(
        (p) => p.id !== panel.id && p.kind === 'code' && baseName(p) === name,
    );
    return collides ? `${name} — ${resolveWorkspaceName(panel.workspace)}` : name;
}
