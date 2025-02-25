"use client";

import { useSendRequest } from "@/hooks/use-send-message";
import { useSendNotification } from "@/hooks/use-send-notification";
import { useFileStore } from "@/store/filetree";
import { FC, useState } from "react";
import ToolBar from "./fileTree/ToolBar";
import FsTree from "./fileTree/Tree";
import CreateFileForm, { FileName } from "./fileTree/TreeForm";
import { IGridviewPanelProps } from "dockview";
import { useKeyboard } from "react-pre-hooks";
import { useEditorStore } from "@/store/editor";

type Props = Record<string, string>;

const FileViewerController: FC<IGridviewPanelProps<Props>> = (props) => {
  const { fileTree, base } = useFileStore();
  const { openFile } = useEditorStore();
  const notificationSender = useSendNotification();
  const requestSender = useSendRequest();
  const [createFile, setCreateFile] = useState(false);

  useKeyboard({
    keys: {
      "meta+b": () => props.api.setVisible(!props.api.isVisible),
    },
  });

  const handleCreateFile = async (body: FileName) => {
    // We need to use an LSP event here for creating a file. Even if we don't tell
    // the actual LSP about it. How would you implement this
    await notificationSender({
      method: "workspace/didChangeWatchedFiles",
      params: {
        changes: [
          {
            uri: `file:///${base}/${body.name}`,
            type: 1, // Created
          },
        ],
      },
    });
    setCreateFile(false);
  };

  const loadAndOpenFile = (path: string) => {
    openFile(`${base}/${path}`);
  };

  const onTest = () => {
    requestSender({
      method: "workspace/workspaceFolders",
      params: {
        workspaceFolders: null,
      },
    });
  };

  return (
    <div className="h-full flex flex-col">
      <ToolBar
        onCreateFile={() => setCreateFile((prev) => !prev)}
        onDebug={() => console.log("debug")}
        onTest={onTest}
      />
      {createFile && <CreateFileForm onCreate={handleCreateFile} />}
      <FsTree files={fileTree?.children} onSelect={loadAndOpenFile} />
    </div>
  );
};

export default FileViewerController;
