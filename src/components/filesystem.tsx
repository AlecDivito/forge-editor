"use client";

import { FC, useState } from "react";
import ToolBar from "./fileTree/ToolBar";
import CreateFileForm, { FileName } from "./fileTree/TreeForm";
import { useFileStore } from "@/store";
import FsTree from "./fileTree/Tree";
import { FileCreated } from "@/interfaces/socket";
import { useSendMessage } from "@/hooks/send-message";

const FileViewerController: FC = ({}) => {
  const tree = useFileStore((state) => state.tree); // Subscribe to changes in files
  const sender = useSendMessage();
  const [createFile, setCreateFile] = useState(false);

  const handleCreateFile = (body: FileName) => {
    const message = FileCreated(body.name);
    sender(message);
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
