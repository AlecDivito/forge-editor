"use client";

import Editor from "./editor";
import FileViewerController from "@/components/filesystem";
import ResizableComponent, { ResizableSides } from "./interaction/resizable";
import { useWebSocket } from "next-ws/client";
import { useEffect, useState } from "react";
import { useFileStore } from "@/store/filetree";
import { LSP_INIT_PARAMS } from "./editor/lsp";
import { ClientAcceptedMessage } from "@/service/lsp";
import { useRequestStore } from "@/store/requests";
import { useNotification } from "@/store/notification";
import { useSendRequest } from "@/hooks/use-send-message";

const VSCodeLayout = () => {
  const ws = useWebSocket();
  const sender = useSendRequest();
  const { base: projectName, handleNotification } = useFileStore();
  const { resolveRequest, rejectRequest, resolveNotification, rejectNotification } = useRequestStore();
  const { pushNotification } = useNotification();

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
      // console.log(response);
      if (response.type === "server-to-client-confirmation") {
        if (response.message.result) {
          resolveNotification(response.id);
        } else {
          rejectNotification(response.id, new Error(`Notifcation failed ${JSON.stringify(response, null, 2)}`));
        }
      } else if (response.type === "server-to-client-response") {
        if ("error" in response.message) {
          rejectRequest(response.id, response.message.error);
        } else if ("method" in response.message && "result" in response.message) {
          resolveRequest(response.id, response.message);
        }
      } else if (response.type === "server-to-client-notification") {
        handleNotification(response.message);
        pushNotification(response.message);
      } else if (response.type === "server-to-client-request") {
        throw new Error("server-to-client-request on the client side editor hasn't been implemented yet.");
      } else {
        throw new Error(`Response type of ${event.data} is currently not handled by the client.`);
      }
    };

    const handleError = (event: unknown) => {
      const error = new Error(`WebSocket error occurred. ${JSON.stringify(event)}`);
      console.log(error);
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
  }, [
    ws,
    handleNotification,
    resolveRequest,
    rejectRequest,
    resolveNotification,
    rejectNotification,
    pushNotification,
  ]);

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
