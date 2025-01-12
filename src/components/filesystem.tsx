"use client";

import { FC, useEffect, useState } from "react";
import ToolBar from "./fileTree/ToolBar";
import CreateFileForm, { FileName } from "./fileTree/TreeForm";
import { useFileStore } from "@/store";
import FsTree from "./fileTree/Tree";
import { useWebSocket } from "./websocketContext";

const FileViewerController: FC = ({}) => {
  const tree = useFileStore((state) => state.tree); // Subscribe to changes in files
  const addFile = useFileStore((state) => state.addFile);
  const websocketService = useWebSocket();
  const [createFile, setCreateFile] = useState(false);

  useEffect(() => {
    websocketService.on("file:created", (data) => {
      if (data?.data?.path) {
        addFile(data.data?.path);
      }
    });

    return () => {
      websocketService.off("file:created");
    };
  }, [websocketService, addFile]);

  const handleCreateFile = (body: FileName) => {
    websocketService.createFile(body.name);
    setCreateFile(false);
  };

  return (
    <div className="h-full flex flex-col">
      <ToolBar onCreateFile={() => setCreateFile((prev) => !prev)} />
      {createFile && <CreateFileForm onCreate={handleCreateFile} />}
      <FsTree files={tree} onSelect={(name) => console.log(name)} />
    </div>
  );
};

export default FileViewerController;
