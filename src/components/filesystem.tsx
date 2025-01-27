"use client";

import { useSendRequest } from "@/hooks/use-send-message";
import { useSendNotification } from "@/hooks/use-send-notification";
import { useFileStore } from "@/store/filetree";
import { FC, useState } from "react";
import ToolBar from "./fileTree/ToolBar";
import FsTree from "./fileTree/Tree";
import CreateFileForm, { FileName } from "./fileTree/TreeForm";

const FileViewerController: FC = ({}) => {
  const { tree, base, activeFiles, openFile } = useFileStore(); // Subscribe to changes in files
  const notificationSender = useSendNotification();
  const requestSender = useSendRequest();
  const [createFile, setCreateFile] = useState(false);

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

  const onDebug = () => {
    requestSender(
      {
        method: "textDocument/documentSymbol",
        params: {
          textDocument: {
            uri: `file:///${Object.keys(activeFiles)[0]}`,
          },
        },
      },
      Object.keys(activeFiles)[0].split(".").pop(),
    );
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
      <ToolBar onCreateFile={() => setCreateFile((prev) => !prev)} onDebug={onDebug} onTest={onTest} />
      {createFile && <CreateFileForm onCreate={handleCreateFile} />}
      <FsTree files={tree} onSelect={loadAndOpenFile} />
    </div>
  );
};

export default FileViewerController;
