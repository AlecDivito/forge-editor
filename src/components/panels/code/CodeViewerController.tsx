import { DockviewApi, DockviewDidDropEvent, DockviewReact, IGridviewPanelProps } from "dockview-react";
import { FC, useEffect, useMemo, useRef, useState } from "react";
import DefaultView from "./components/DefaultView/DefaultView";
import FileTab from "./components/FileTab/FileTab";
import CodeView from "./components/CodeView/CodeView";
import { titleFor, useUICodeState } from "./hooks/use-code-ui-state.hook";
import { useKeyboard } from "react-pre-hooks";

type Props = Record<string, string>;

const CodeViewerController: FC<IGridviewPanelProps<Props>> = (props) => {
    const [view, setView] = useState<DockviewApi | null>(null);
    const openPanels = useUICodeState((s) => s.openPanels);
    const closeFile = useUICodeState((s) => s.closeFile);
    const syncGroups = useUICodeState((s) => s.syncGroups);
    const setActivePanel = useUICodeState((s) => s.setActivePanel);
    const knownIds = useRef(new Set<string>());

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
                view.getPanel(id)?.api.close();
                knownIds.current.delete(id);
            }
        }

        for (const panel of openPanels) {
            const handle = view.getPanel(panel.id);
            if (!handle) continue;
            const nextTitle = titleFor(panel, openPanels);
            if (handle.title !== nextTitle) handle.setTitle(nextTitle);
        }
    }, [view, openPanels]);

    // catches closes Dockview performs on its own (drag-out, its native
    // close affordance if a panel ever lacks our custom tab, etc.) and
    // reconciles the store so it never disagrees with what's on screen.
    useEffect(() => {
        if (!view) return;
        const disposable = view.onDidRemovePanel((panel) => {
            knownIds.current.delete(panel.id);
            closeFile(panel.id); // no-op if the store already removed it
        });
        return () => disposable.dispose();
    }, [view, closeFile]);

    // Mirror dockview's own grouping/active-panel state into the store so
    // things outside the dockview tree (sidebar highlighting, breadcrumbs,
    // etc.) can read it without reaching into the dockview api. This covers
    // drag-to-reorder and splits too, since both fire onDidLayoutChange —
    // dockview stays the actual source of truth for layout; this is read-only.
    useEffect(() => {
        if (!view) return;

        const pushSnapshot = () => {
            const groups = view.groups.map((g) => ({
                id: g.id,
                panelIds: g.panels.map((p) => p.id),
                activePanelId: g.activePanel?.id,
            }));
            syncGroups(groups, groups.map((g) => g.id));
        };

        pushSnapshot(); // seed initial state — don't wait for the first change

        const layoutSub = view.onDidLayoutChange(pushSnapshot);
        const activeSub = view.onDidActivePanelChange((panel) => {
            setActivePanel(panel?.id ?? null, panel?.group?.id ?? null);
        });

        return () => {
            layoutSub.dispose();
            activeSub.dispose();
        };
    }, [view, syncGroups, setActivePanel]);

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
                if (active) closeFile(active.id); // through the store, not api.close()
            },
        },
    });

    const onDidDrop = (event: DockviewDidDropEvent) => {
        console.log(event);
    };

    return (
        <DockviewReact
            onReady={(e) => setView(e.api)}
            components={components}
            tabComponents={tabComponents}
            onDidDrop={onDidDrop}
            className="dockview-theme-vs"
        />
    );
};

export default CodeViewerController;