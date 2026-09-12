"use client";

import FileViewerController from "@/components/panels/filesystem/filesystem";
import { Orientation } from "dockview";
import Chat from "./chat";
import Terminal from "./terminal";
import CommandPallet from "./panels/commandPallet/CommandPallet";

import { GridviewReact, GridviewReadyEvent } from "dockview-react"
import CodeViewerController from "./panels/code/CodeViewerController";
import { useLspEventRouter } from "@/lib/ws/use-lsp-event-router";
import { LspNotifications } from "./notifications/LspNotifications";

const components = {
  filesystem: FileViewerController,
  code: CodeViewerController,
  terminal: Terminal,
  chat: Chat,
};

const VSCodeLayout = () => {
  useLspEventRouter();
  // const ws = useWebSocket();
  // const sender = useSendRequest();
  // const { handleNotification: handleFileTreeNotification } = useFileStore();
  // const { handleNotification: handleEditorNotification } = useEditorStore();
  // const { handleNotification: handleLspNotification } = useLspStore();
  // const { handleNotification: handlePushNotification } = useNotification();
  // const { resolveRequest, rejectRequest, resolveNotification, rejectNotification } = useRequestStore();

  // useEffect(() => {
  //   if (!ws || !base) {
  //     return;
  //   }

  //   const f = async () => {
  //     console.log("Initializing project");
  //     await sender({
  //       method: "initialize",
  //       params: LSP_INIT_PARAMS(base),
  //     });
  //     console.log("Project successfully Initialized");
  //   };

  //   f();
  // }, [sender, ws, base]);

  // useEffect(() => {
  //   const handleMessage = (event: { data: string }) => {
  //     const response = JSON.parse(event.data) as ClientAcceptedMessage;
  //     console.log(response);
  //     if (response.type === "server-to-client-confirmation") {
  //       if (response.message.result) {
  //         resolveNotification(response.id);
  //       } else {
  //         rejectNotification(response.id, new Error(`Notifcation failed ${JSON.stringify(response, null, 2)}`));
  //       }
  //     } else if (response.type === "server-to-client-response") {
  //       if ("error" in response.message) {
  //         rejectRequest(response.id, response.message.error);
  //       } else if ("method" in response.message && "result" in response.message) {
  //         resolveRequest(response.id, response.message);
  //       }
  //     } else if (response.type === "server-to-client-notification") {
  //       handleFileTreeNotification(response.message);
  //       handleEditorNotification(response.message);
  //       handleLspNotification(response.message);
  //       handlePushNotification(response.message);
  //     } else if (response.type === "server-to-client-request") {
  //       throw new Error("server-to-client-request on the client side editor hasn't been implemented yet.");
  //     } else {
  //       throw new Error(`Response type of ${event.data} is currently not handled by the client.`);
  //     }
  //   };

  //   const handleError = (event: unknown) => {
  //     const error = new Error(`WebSocket error occurred. ${JSON.stringify(event)}`);
  //     console.log(error);
  //     Object.keys(useRequestStore.getState().requests).forEach((id) => {
  //       rejectRequest(id, error);
  //     });
  //   };

  //   ws?.addEventListener("message", handleMessage);
  //   ws?.addEventListener("error", handleError);
  //   ws?.addEventListener("close", handleError);

  //   return () => {
  //     ws?.removeEventListener("message", handleMessage);
  //     ws?.removeEventListener("error", handleError);
  //     ws?.removeEventListener("close", handleError);
  //   };
  // }, [
  //   ws,
  //   resolveRequest,
  //   rejectRequest,
  //   resolveNotification,
  //   rejectNotification,
  //   handleFileTreeNotification,
  //   handleEditorNotification,
  //   handleLspNotification,
  //   handlePushNotification,
  // ]);

  const onReady = (event: GridviewReadyEvent) => {
    event.api.addPanel({
      id: "code",
      component: "code",
      params: {},
    });

    event.api.addPanel({
      id: "filesystem",
      component: "filesystem",
      params: {},
      position: { referencePanel: "code", direction: "left" },
    });

    // const chat = event.api.addPanel({
    //   id: "chat",
    //   component: "chat",
    //   params: {},
    //   position: { referencePanel: "code", direction: "right" },
    // });
    // chat.api.setVisible(false);

    // event.api.addPanel({
    //   id: "terminal",
    //   component: "terminal",
    //   params: {},
    //   position: { referencePanel: "code", direction: "below" },
    // });
  };

  return (
    <div className="flex h-screen">
      <CommandPallet />
      <LspNotifications />
      <GridviewReact components={components} onReady={onReady} orientation={Orientation.VERTICAL} />
    </div>
  );
};

export default VSCodeLayout;
