"use client";

import FileViewerController from "@/components/filesystem";

// import dynamic from "next/dynamic";
import ResizableComponent, { ResizableSides } from "./interaction/resizable";
import { useWebSocket } from "next-ws/client";
import { useEffect, useState } from "react";
import { useFileStore } from "@/store/filetree";
import Editor from "./editor";
import { LspProxyResponse, useSendLspMessage } from "@/hooks/use-send-message";
import { LSP_INIT_PARAMS } from "./editor/lsp";
import { LspResponse } from "@/service/lsp";

// const DynamicTerminal = dynamic(() => import("@/components/terminal"), {
//   ssr: false,
// });

const VSCodeLayout = () => {
  const ws = useWebSocket();
  const sender = useSendLspMessage();
  const projectName = useFileStore((state) => state.base);
  const handleUpdate = useFileStore((state) => state.handleUpdate);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [fileViewerWidth, setFileViewerWidth] = useState(300);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [editorHeight, setEditorHeight] = useState(200);

  useEffect(() => {
    if (!ws || !projectName) {
      return;
    }

    const f = async () => {
      console.log("Initializing project");
      await sender({
        method: "initialize",
        params: LSP_INIT_PARAMS(projectName),
      });
      console.log("Project successfully Initialized");
    };

    f();
  }, [sender, ws, projectName]);

  useEffect(() => {
    async function onMessage(event: MessageEvent) {
      // TODO: Remove the idea of a Message and replace it with responses from
      //       the language server.
      const message = JSON.parse(event.data) as LspResponse;
      if ("message" in message) {
        console.info(`Received response for method ${message.message.method}`);
      } else if ("error" in message) {
        console.error(`Lsp Proxy failed with error ${message.error.message}`);
      }
      handleUpdate(message);
    }

    ws?.addEventListener("message", onMessage);
    return () => ws?.removeEventListener("message", onMessage);
  }, [ws, handleUpdate]);

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
