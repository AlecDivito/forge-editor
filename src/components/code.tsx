"use client";

import Editor from "./editor";
import FileViewerController from "@/components/filesystem";
import ResizableComponent, { ResizableSides } from "./interaction/resizable";
import { useWebSocket } from "next-ws/client";
import { useEffect, useState } from "react";
import { useFileStore } from "@/store/filetree";
import { useSendLspMessage } from "@/hooks/use-send-message";
import { LSP_INIT_PARAMS } from "./editor/lsp";
import { ClientAcceptedMessage } from "@/service/lsp";
import { useRequestStore } from "@/store/requests";

const VSCodeLayout = () => {
  const ws = useWebSocket();
  const sender = useSendLspMessage();
  const { base: projectName, handleNotification } = useFileStore();
  const { resolveRequest, rejectRequest } = useRequestStore();

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
    const handleMessage = (event: { data: string }) => {
      const response = JSON.parse(event.data) as ClientAcceptedMessage;
      if (response.type === "server-to-client-confirmation") {
      } else if (response.type === "server-to-client-response") {
      } else if (response.type === "server-to-client-notification") {
      } else if (response.type === "server-to-client-request") {
      } else {
      }
    };

    const handleError = (event: unknown) => {
      const error = new Error(`WebSocket error occurred. ${event}`);
      console.error(error);
      Object.keys(useRequestStore.getState().requests).forEach((id) => {
        rejectRequest(id, error);
      });
    };

    ws?.addEventListener("message", handleMessage);
    ws?.addEventListener("error", handleError);
    ws?.addEventListener("close", handleError);

    return () => {
      ws?.removeEventListener("message", handleMessage);
      ws?.removeEventListener("error", handleError);
      ws?.removeEventListener("close", handleError);
    };
  }, [ws, handleNotification, resolveRequest, rejectRequest]);

  const handleResize = (side: ResizableSides, size: number) => {
    if (side === "right") {
      setFileViewerWidth(size);
    } else if (side === "bottom") {
      setEditorHeight(size);
    }
  };

  return (
    <div className="flex h-screen">
      <ResizableComponent resizableSides={{ right: true }} className="flex-shrink-0" onResize={handleResize}>
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
