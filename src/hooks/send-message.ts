import { Message } from "@/interfaces/socket";
import { useWebSocket } from "next-ws/client";
import { useCallback } from "react";

export const useSendMessage = () => {
  const ws = useWebSocket();
  const sendMessage = useCallback(
    (
      message: Message,
      onSuccess?: (message: Message) => void,
      onError?: (error: Error) => void
    ) => {
      try {
        if (!message) throw new Error("Message is required to send a message.");

        // Send the create:file event through WebSocket
        ws?.send(JSON.stringify(message));

        // Call the success callback if provided
        onSuccess?.(message);
      } catch (error) {
        console.error("Failed to create file:", error);
        onError?.(error as Error);
      }
    },
    [ws]
  );

  return sendMessage;
};
