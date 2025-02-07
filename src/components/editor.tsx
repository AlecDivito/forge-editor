"use client";

import { FC, useEffect, useState } from "react";
import { useFileStore } from "@/store/filetree";
import {
  DockviewApi,
  DockviewDidDropEvent,
  DockviewReact,
  // IDockviewGroupPanel,
  IDockviewPanel,
} from "dockview";
import EditorView from "./editor/EditorView";
import FileTab from "./editor/FileTab";
import DefaultView from "./editor/DefaultView";
import { useNotification } from "@/store/notification";
import { useSendNotification } from "@/hooks/use-send-notification";

interface Props {
  theme?: "material" | "gruvbox";
  onThemeLoadError?: (error: Error) => void;
}

const Editor: FC<Props> = ({ theme = "gruvbox" }) => {
  const { base, activeFiles, capabilities } = useFileStore((state) => state);
  const { notifications } = useNotification();
  const sendNotification = useSendNotification();
  const [view, setView] = useState<DockviewApi | null>(null);
  // const [activeGroup, setActiveGroup] = useState<IDockviewGroupPanel[]>([]);
  const [panels, setPanels] = useState<IDockviewPanel[]>([]);

  useEffect(() => {
    if (view) {
      const addPanel = view.onDidAddPanel((e) => {
        if (e.params?.file && e.params?.extension) {
          // languageId, version and text will be inserted by the server
          sendNotification(
            {
              method: "textDocument/didOpen",
              params: {
                textDocument: {
                  uri: `file:///${e.params.file}`,
                  languageId: "",
                  version: 0,
                  text: "",
                },
              },
            },
            e.params.file.split(".").pop(),
          );
        }
      });
      const removePanel = view.onDidRemovePanel((e) => {
        if (e.params?.file && e.params?.extension) {
          sendNotification(
            {
              method: "textDocument/didClose",
              params: {
                textDocument: {
                  uri: `file:///${e.params.file}`,
                },
              },
            },
            e.params.file.split(".").pop(),
          );
        }
      });
      const addGroup = view.onDidAddGroup((e) => {
        console.log(e);
      });
      const removeGroup = view.onDidRemoveGroup((e) => {
        console.log(e);
      });
      const disposable = view.onUnhandledDragOverEvent((event) => {
        event.accept();
      });

      return () => {
        addPanel.dispose();
        removePanel.dispose();
        removeGroup.dispose();
        addGroup.dispose();
        disposable.dispose();
      };
    }
  }, [view, base, sendNotification]);

  useEffect(() => {
    if (view && activeFiles) {
      const openFiles = panels.map((panel) => panel.params?.file).filter((file) => file);
      const toOpen = Object.keys(activeFiles);

      for (const file of [...openFiles, ...toOpen]) {
        console.log(file);
        const panel = view.getPanel(file);
        if (!panel) {
          view.addPanel({
            id: file,
            tabComponent: "fileTab",
            component: "editor",
            params: { file, theme, extension: file.split(".").pop() || "" },
          });
        }
      }
    }
  }, [theme, view, panels, activeFiles, setPanels]);

  const components = {
    default: DefaultView,
    editor: EditorView,
  };

  const tabComponents = {
    fileTab: FileTab,
  };

  const onDidDrop = (event: DockviewDidDropEvent) => {
    console.log(event);
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
      {/* <div className="w-full">
        <pre>Active: {JSON.stringify(activeFiles, null, 2)}</pre>
        <pre>Capabilities: {JSON.stringify(capabilities, null, 2)}</pre>
        <pre>Notifications: {JSON.stringify(notifications, null, 2)}</pre>
      </div> */}
    </>
  );
};

export default Editor;
