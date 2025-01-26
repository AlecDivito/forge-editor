"use client";

import { FC, useState } from "react";
import ToolBar from "./fileTree/ToolBar";
import CreateFileForm, { FileName } from "./fileTree/TreeForm";
import { useFileStore } from "@/store/filetree";
import FsTree from "./fileTree/Tree";
import { useSendLspMessage } from "@/hooks/use-send-message";

const FileViewerController: FC = ({}) => {
  const { tree, base, activeFiles, openFile } = useFileStore(); // Subscribe to changes in files
  const sender = useSendLspMessage();
  const [createFile, setCreateFile] = useState(false);

  const handleCreateFile = async (body: FileName) => {
    // We need to use an LSP event here for creating a file. Even if we don't tell
    // the actual LSP about it. How would you implement this
    await sender({
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
    sender(
      {
        method: "textDocument/documentSymbol",
        params: {
          textDocument: {
            uri: `file:///${Object.keys(activeFiles)[0]}`,
          },
        },
      },
      Object.keys(activeFiles)[0].split(".").pop()
    );
  };

  const onTest = () => {
    sender({
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
        onDebug={onDebug}
        onTest={onTest}
      />
      {createFile && <CreateFileForm onCreate={handleCreateFile} />}
      <FsTree files={tree} onSelect={loadAndOpenFile} />
    </div>
  );
};

export default FileViewerController;
