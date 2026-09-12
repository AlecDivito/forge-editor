import { DockviewApi, DockviewDidDropEvent, DockviewReact, IGridviewPanelProps } from "dockview-react";
import { FC, useEffect, useMemo, useRef, useState } from "react";
import DefaultView from "./components/DefaultView/DefaultView";
import FileTab from "./components/FileTab/FileTab";
import CodeView from "./components/CodeView/CodeView";
import { useShallow } from "zustand/react/shallow";
import { selectPanels, useEditorSessionStore } from "./state/editor-session.store";
import { titleFor } from "./state/panel-title";
import { useKeyboard } from "react-pre-hooks";
import { saveDocument } from "@/lib/documents/save";
import { hasUnsavedDocuments } from "@/lib/documents/registry";
import CloseConfirmationDialog from "./components/CloseConfirmationDialog/CloseConfirmationDialog";

type Props = Record<string, string>;

const CodeViewerController: FC<IGridviewPanelProps<Props>> = (props) => {
    const [view, setView] = useState<DockviewApi | null>(null);
    const openPanels = useEditorSessionStore(useShallow(selectPanels));
    const requestClose = useEditorSessionStore((s) => s.requestClose);
    const setActivePanel = useEditorSessionStore((s) => s.setActivePanel);
    const knownIds = useRef(new Set<string>());
    const suppressNativeRemoval = useRef(new Set<string>());

    useEffect(() => {
        const beforeUnload = (event: BeforeUnloadEvent) => {
            if (!hasUnsavedDocuments()) return;
            event.preventDefault();
            event.returnValue = "";
        };
        window.addEventListener("beforeunload", beforeUnload);
        return () => window.removeEventListener("beforeunload", beforeUnload);
    }, []);

    const components = useMemo(() => ({
        default: DefaultView,
        code: CodeView,
        // terminal: TerminalView,
    }), []);

    const tabComponents = useMemo(() => ({
        fileTab: FileTab,
    }), []);

    // Add/remove panels to match the store, and keep every code tab's title
    // correct — including relabeling tabs that DIDN'T just open/close, since
    // opening or closing one file can create or resolve a basename collision
    // for another (two workspaces both having "index.ts", say).
    useEffect(() => {
        if (!view) return;
        const current = new Set(openPanels.map((p) => p.id));

        for (const panel of openPanels) {
            if (knownIds.current.has(panel.id)) continue;
            view.addPanel({
                id: panel.id,
                component: panel.kind,
                tabComponent: panel.kind === 'code' ? 'fileTab' : undefined,
                params: panel,
                title: titleFor(panel, openPanels),
            });
            knownIds.current.add(panel.id);
        }

        for (const id of knownIds.current) {
            if (!current.has(id)) {
                // This close was initiated by the UI store. Mark it so the
                // native removal callback cannot start a second close request.
                suppressNativeRemoval.current.add(id);
                view.getPanel(id)?.api.close();
                knownIds.current.delete(id);
            }
        }

        for (const panel of openPanels) {
            const handle = view.getPanel(panel.id);
            if (!handle) continue;
            const nextTitle = titleFor(panel, openPanels);
            if (handle.title !== nextTitle) handle.setTitle(nextTitle);
            // Keep the existing Dockview panel/editor instance while updating
            // the path after an authoritative filesystem rename.
            handle.update({ params: panel });
        }
    }, [view, openPanels]);

    // catches closes Dockview performs on its own (drag-out, its native
    // close affordance if a panel ever lacks our custom tab, etc.) and
    // reconciles the store so it never disagrees with what's on screen.
    useEffect(() => {
        if (!view) return;
        const disposable = view.onDidRemovePanel((panel) => {
            knownIds.current.delete(panel.id);
            if (suppressNativeRemoval.current.delete(panel.id)) return;
            // Dockview has already removed the panel by this point. The store
            // still owns the descriptor. Restore it synchronously when the
            // guard needs it; this avoids a native removal bypassing the
            // dialog even though openPanels itself did not change.
            requestClose(panel.id);
            const state = useEditorSessionStore.getState();
            const descriptor = state.panelsById[panel.id];
            if (descriptor) {
                view.addPanel({
                    id: descriptor.id,
                    component: descriptor.kind,
                    tabComponent: descriptor.kind === 'code' ? 'fileTab' : undefined,
                    params: descriptor,
                    title: titleFor(descriptor, selectPanels(state)),
                });
                knownIds.current.add(descriptor.id);
            }
        });
        return () => disposable.dispose();
    }, [view, requestClose]);

    // Dockview owns layout/group ordering. Only mirror the selected panel id,
    // which other UI can join to both the panel descriptor and EditorView.
    useEffect(() => {
        if (!view) return;
        const activeSub = view.onDidActivePanelChange((panel) => {
            setActivePanel(panel.panel?.id ?? null);
        });
        setActivePanel(view.activePanel?.id ?? null);
        return () => activeSub.dispose();
    }, [view, setActivePanel]);

    useKeyboard({
        keys: {
            'meta+b': () => props.api.setVisible(!props.api.isVisible),

            // mod+1..9: focus the Nth group, matching every editor's convention
            ...Object.fromEntries(
                Array.from({ length: 9 }, (_, i) => [
                    `mod+${i + 1}`,
                    () => view?.groups[i]?.api.setActive(),
                ]),
            ),

            'mod+w': () => {
                const active = view?.activePanel;
                if (active) requestClose(active.id);
            },

            'mod+s': () => {
                const panel = view?.activePanel;
                const workspace = panel?.params?.workspace;
                const fileId = panel?.params?.fileId;
                if (workspace === undefined || fileId === undefined) return;
                void saveDocument(workspace, fileId).catch((error) => {
                    console.error("Failed to save document", error);
                });
            },
        },
    });

    const onDidDrop = (event: DockviewDidDropEvent) => {
        console.log(event);
    };

    return <>
        <DockviewReact
            onReady={(e) => setView(e.api)}
            components={components}
            tabComponents={tabComponents}
            onDidDrop={onDidDrop}
            className="dockview-theme-vs"
        />
        <CloseConfirmationDialog />
    </>;
};

export default CodeViewerController;
