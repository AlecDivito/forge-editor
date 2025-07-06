"use client";

import { useSendNotification } from "@/hooks/use-send-notification";
import { useFileStore } from "@/store/filetree";
import { FC, useCallback, useEffect, useRef } from "react";
import FsTree from "./fileTree/Tree";
import { FileName } from "./fileTree/TreeForm";
import { IGridviewPanelProps } from "dockview";
import { useKeyboard } from "react-pre-hooks";
import { useEditorStore } from "@/store/editor";
import { FaFile, FaSearch } from "react-icons/fa";
import { CommandEvent, useCommandQueue } from "@/store/commands";
import { useSendRequest } from "@/hooks/use-send-message";

type Props = Record<string, string>;

const FileViewerController: FC<IGridviewPanelProps<Props>> = (props) => {
  const { fileTree, base, insertFile, insertFolder, hideInsertFile } = useFileStore();
  const { openFile } = useEditorStore();
  const notificationSender = useSendNotification();
  const requestSender = useSendRequest();
  const { subscribe, unsubscribe } = useCommandQueue();
  const subscriptionId = useRef<null | number>(-1);
  const eventHandler = useCallback(
    (cmd: CommandEvent) => {
      if (cmd.type === "file.new") {
        insertFile(cmd.parent);
      } else if (cmd.type === "folder.new") {
        insertFolder(cmd.parent);
      } else if (cmd.type === "file.new.hide" || cmd.type === "folder.new.hide") {
        hideInsertFile(cmd.path);
      } else if (cmd.type === "file.create") {
        requestSender({
          
        })
      } else if (cmd.type === "folder.create") {
        createFolder(cmd.path);
      }
    },
    [insertFolder, insertFile, hideInsertFile, requestSender],
  );
  useKeyboard({
    keys: {
      "meta+b": () => props.api.setVisible(!props.api.isVisible),
    },
  });

  useEffect(() => {
    if (subscriptionId.current === -1) {
      const id = subscribe(eventHandler);
      subscriptionId.current = id;
    }
    return () => {
      if (subscriptionId.current) {
        unsubscribe(subscriptionId.current);
      }
    };
  }, [subscriptionId, eventHandler, subscribe, unsubscribe]);

  const handleCreateFile = async (body: FileName) => {
    // We need to use an LSP event here for creating a file. Even if we don't tell
    // the actual LSP about it. How would you implement this
    await notificationSender({
      method: "workspace/didChangeWatchedFiles",
      params: {
        changes: [
          {
            uri: `file:///${base}${body.name}`,
            type: 1, // Created
          },
        ],
      },
    });
    setCreateFile(false);
  };

  const loadAndOpenFile = (path: string) => {
    openFile(`file:///${base}${path}`);
  };

  return (
    <div className="h-full flex">
      {/* <ToolBar
          onCreateFile={() => setCreateFile((prev) => !prev)}
          onDebug={() => console.log("debug")}
          onTest={onTest}
        />*/}
      <div className="h-full w-[50px] bg-gray-300 border-red-500">
        <div className="bg-gray-500 h-[50px] w-[50px] flex justify-center items-center">
          <FaFile className="cursor-pointer" size={20} title="Create File" />
        </div>
        <div className="bg-gray-500 h-[50px] w-[50px] flex justify-center items-center">
          <FaSearch className="cursor-pointer" size={20} title="Search files" />
        </div>
      </div>
      <FsTree node={fileTree!} onSelect={loadAndOpenFile} />
    </div>
  );
};

export default FileViewerController;
