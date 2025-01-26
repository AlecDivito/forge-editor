import { useCallback } from "react";

export const useWaitForWebSocketReady = (ws?: WebSocket | null) => {
  return useCallback(
    () =>
      new Promise<void>((resolve, reject) => {
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
      }),
    [ws],
  );
};
