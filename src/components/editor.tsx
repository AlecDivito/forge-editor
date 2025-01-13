"use client";

import { FC, useEffect, useState } from "react";
import { useFileStore } from "@/store";
import { DockviewApi, DockviewDidDropEvent, DockviewReact } from "dockview";
import EditorView from "./editor/EditorView";
import FileTab from "./editor/FileTab";
import DefaultView from "./editor/DefaultView";

interface Props {
  theme?: "material" | "gruvbox";
  onThemeLoadError?: (error: Error) => void;
}

const Editor: FC<Props> = ({ theme = "gruvbox" }) => {
  const activeGroup = useFileStore((state) => state.activeGroup);
  const panels = useFileStore((state) => state.openFiles);
  const files = useFileStore((state) => state.files);
  const { closeFile, addGroup } = useFileStore((state) => state);
  const [view, setView] = useState<DockviewApi | null>(null);

  useEffect(() => {
    if (view) {
      const removePanel = view.onDidRemovePanel((e) => {
        closeFile(e.id, e.params?.file);
      });
      const addGroup = view.onDidAddGroup((e) => {
        console.log(e);
        // addGroup();
      });
      const disposable = view.onUnhandledDragOverEvent((event) => {
        event.accept();
      });

      return () => {
        removePanel.dispose();
        addGroup.dispose();
        disposable.dispose();
      };
    }
  }, [view, addGroup, closeFile]);

  useEffect(() => {
    if (view && panels && files) {
      const ids: string[] = [];
      Object.entries(panels).forEach(([groupName, files]) => {
        // This acts as a group
        let lastPanel = null;
        for (const file of files) {
          const childPanelKey = `${groupName}-${file}`;
          let childPanel = view.getPanel(childPanelKey);

          if (!childPanel) {
            childPanel = view.addPanel({
              id: childPanelKey,
              tabComponent: "fileTab",
              component: "editor",
              position: lastPanel ? { referencePanel: lastPanel } : undefined,
              params: { file, group: groupName, theme },
            });
          }
          ids.push(childPanelKey);
          lastPanel = childPanel;
        }
      });

      // Remove any of the panels that don't exist anymore
      const toRemovePanels = view.panels.filter(
        (panel) => !ids.includes(panel.id)
      );
      for (const panel of toRemovePanels) {
        view.removePanel(panel);
      }
    }
  }, [view, panels, files, theme]);

  const components = {
    default: DefaultView,
    editor: EditorView,
  };

  const tabComponents = {
    fileTab: FileTab,
  };

  const onDidDrop = (event: DockviewDidDropEvent) => {
    console.log(event);
    // const path = event.
    // if (!files[path]) {
    //       const message = ReadFile(path);
    //       sender(message, () => openFile(path));
    //     } else {
    //       openFile(path);
    //     }
  };

  return (
    <>
      <div className="flex-grow border border-red-500">
        <DockviewReact
          onReady={(view) => setView(view.api)}
          components={components}
          tabComponents={tabComponents}
          onDidDrop={onDidDrop}
          className={"dockview-theme-abyss"}
        />
      </div>
      <div>
        <pre>Active: {activeGroup}</pre>
        <pre>panels: {JSON.stringify(panels, null, 2)}</pre>
        <pre>Files: {JSON.stringify(files, null, 2)}</pre>
      </div>
    </>
  );
};

export default Editor;
