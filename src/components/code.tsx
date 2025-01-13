"use client";

import FileViewerController from "@/components/filesystem";

// import dynamic from "next/dynamic";
import ResizableComponent, { ResizableSides } from "./interaction/resizable";
import { useWebSocket } from "next-ws/client";
import { useEffect, useState } from "react";
import { Message } from "@/interfaces/socket";
import { useFileStore } from "@/store";
import Editor from "./editor";

// const DynamicTerminal = dynamic(() => import("@/components/terminal"), {
//   ssr: false,
// });

const VSCodeLayout = () => {
  const ws = useWebSocket();
  const handleMessage = useFileStore((state) => state.handleMessage);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [fileViewerWidth, setFileViewerWidth] = useState(300);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [editorHeight, setEditorHeight] = useState(200);

  useEffect(() => {
    async function onMessage(event: MessageEvent) {
      const message = JSON.parse(event.data) as Message;
      handleMessage(message);
    }

    ws?.addEventListener("message", onMessage);
    return () => ws?.removeEventListener("message", onMessage);
  }, [ws, handleMessage]);

  const handleResize = (side: ResizableSides, size: number) => {
    if (side === "right") {
      setFileViewerWidth(size);
    } else if (side === "bottom") {
      setEditorHeight(size);
    }
  };

  return (
    <div className="flex h-screen">
      <ResizableComponent
        resizableSides={{ right: true }}
        className="flex-shrink-0"
        onResize={handleResize}
      >
        <FileViewerController />
      </ResizableComponent>

      <div className="flex flex-col flex-1">
        {/* <div className="flex-grow border border-red-500"></div> */}
        <Editor />
      </div>
      {/*
        <ResizableComponent
          resizableSides={{ top: true }}
          className="flex-shrink-0"
          onResize={(size) => handleResize("bottom", size)}
        >
          <DynamicTerminal />
        </ResizableComponent>
      </div> */}
    </div>
  );
};

export default VSCodeLayout;
