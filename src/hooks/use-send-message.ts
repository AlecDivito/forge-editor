import { useWebSocket } from "next-ws/client";
import { useCallback } from "react";
import { ClientLspRequest, ClientLspResponse, ServerAcceptedMessage } from "@/service/lsp";
import { nanoid } from "nanoid";
import { useRequestStore } from "@/store/requests";
import { useFileStore } from "@/store/filetree";
import { useWaitForWebSocketReady } from "./use-wait-for-web-socket-ready";

export type SendRequest = (message: ClientLspRequest, overrideLanguage?: string) => Promise<ClientLspResponse>;

export const useSendRequest = (language?: string) => {
  const ws = useWebSocket();
  const waitForWebSocketReady = useWaitForWebSocketReady(ws);
  const workspace = useFileStore((state) => state.base);
  const { addRequest } = useRequestStore();

  // Send an LSP message and return a Promise
  const sendMessage: SendRequest = useCallback(
    async (message: ClientLspRequest, overrideLanguage?: string) => {
      return new Promise<ClientLspResponse>(async (resolve, reject) => {
        try {
          if (!message) {
            throw new Error("Message is required to send a message.");
          }

          const id = nanoid(); // Generate a unique ID

          // Store the request's resolve and reject functions in Zustand
          addRequest(id, resolve, reject);

          // Wait for the WebSocket to be ready
          await waitForWebSocketReady();

          const request: ServerAcceptedMessage = {
            type: "client-to-server-request",
            id,
            ctx: { workspace, language: overrideLanguage || language || "text" },
            message,
          };
          // Send the message over WebSocket
          // console.log(`Sending ${request.type} ${message.method}`, JSON.stringify(request, null, 2));
          ws!.send(JSON.stringify(request));
        } catch (error) {
          reject(error);
        }
      });
    },
    [ws, workspace, language, addRequest, waitForWebSocketReady],
  );

  return sendMessage;
};
