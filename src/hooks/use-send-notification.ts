import { ClientLspNotification, ServerAcceptedMessage } from "@/service/lsp";
import { useFileStore } from "@/store/filetree";
import { useWebSocket } from "next-ws/client";
import { useCallback } from "react";
import { useWaitForWebSocketReady } from "./use-wait-for-web-socket-ready";
import { useRequestStore } from "@/store/requests";
import { nanoid } from "nanoid";

export type SendLspNotification = (message: ClientLspNotification, overrideLanguage?: string) => Promise<voids>;

export const useSendNotification = (language?: string) => {
  const ws = useWebSocket();
  const waitForWebSocketReady = useWaitForWebSocketReady(ws);
  const workspace = useFileStore((state) => state.base);
  const { addNotification } = useRequestStore();

  const sendNotification: SendLspNotification = useCallback(
    async (message: ClientLspNotification, overrideLanguage?: string) => {
      return new Promise<void>(async (resolve, reject) => {
        try {
          await waitForWebSocketReady();

          const id = nanoid(); // Generate a unique ID

          // Store the request's resolve and reject functions in Zustand
          addNotification(id, resolve, reject);

          if (!ws) {
            throw new Error("Websocket must be created for us to send a message.");
          }

          const request: ServerAcceptedMessage = {
            type: "client-to-server-notification",
            id,
            ctx: { workspace, language: overrideLanguage || language },
            message,
          };

          // console.log(`Sending ${request.type} ${message.method}`, JSON.stringify(request, null, 2));
          ws!.send(JSON.stringify(request));
        } catch (error) {
          reject(error);
        }
      });
    },
    [ws, language, workspace, waitForWebSocketReady, addNotification],
  );

  return sendNotification;
};
