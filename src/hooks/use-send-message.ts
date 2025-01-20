import { useWebSocket } from "next-ws/client";
import { useCallback, useEffect } from "react";
import { LspMessage, LspResponse } from "@/service/lsp";
import { nanoid } from "nanoid";
import { useRequestStore } from "@/store/requests";
import { useFileStore } from "@/store/filetree";

export interface LspProxyMessage {
  id: string;
  base: string;
  language?: string;
  message: LspMessage;
}

export type SendLspMessage = (
  message: LspMessage,
  overrideLanguage?: string
) => Promise<LspResponse>;

export const useSendLspMessage = (language?: string) => {
  const ws = useWebSocket();
  const base = useFileStore((state) => state.base);
  const { addRequest, resolveRequest, rejectRequest } = useRequestStore();

  const waitForWebSocketReady = useCallback(() => {
    return new Promise<void>((resolve, reject) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        resolve();
      } else if (ws) {
        const handleOpen = () => {
          ws.removeEventListener("open", handleOpen);
          resolve();
        };

        const handleError = () => {
          ws.removeEventListener("error", handleError);
          reject(new Error("WebSocket failed to open."));
        };

        ws.addEventListener("open", handleOpen);
        ws.addEventListener("error", handleError);
      } else {
        reject(new Error("WebSocket is not initialized."));
      }
    });
  }, [ws]);

  // Send an LSP message and return a Promise
  const sendMessage: SendLspMessage = useCallback(
    async (message: LspMessage, overrideLanguage?: string) => {
      return new Promise<LspResponse>(async (resolve, reject) => {
        try {
          if (!message) {
            throw new Error("Message is required to send a message.");
          }

          const id = nanoid(); // Generate a unique ID

          // Store the request's resolve and reject functions in Zustand
          addRequest(id, resolve, reject);

          // Wait for the WebSocket to be ready
          await waitForWebSocketReady();

          // Send the message over WebSocket
          console.info(`Sending ${message.method}`);
          console.log(
            JSON.stringify({
              id,
              base,
              language: overrideLanguage || language,
              message,
            })
          );
          ws!.send(
            JSON.stringify({
              id,
              base,
              language: overrideLanguage || language,
              message,
            })
          );
        } catch (error) {
          reject(error);
        }
      });
    },
    [ws, base, language, addRequest, waitForWebSocketReady]
  );

  // Listen for WebSocket responses
  useEffect(() => {
    const handleMessage = (event: { data: string }) => {
      const response = JSON.parse(event.data);

      if (response.id) {
        resolveRequest(response.id, response);
      }
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleError = (event: any) => {
      const error = new Error(`WebSocket error occurred. ${event}`);
      console.error(error);
      // Reject all in-progress requests if the WebSocket closes or errors
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
  }, [ws, resolveRequest, rejectRequest]);

  return sendMessage;
};
