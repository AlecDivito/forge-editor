import { useCallback } from "react";

export function useCommandRunner(close: () => void) {
  return useCallback(
    (command: () => void | Promise<void>) => {
      close();
      void Promise.resolve(command()).catch((error) => {
        console.error("Command failed", error);
      });
    },
    [close],
  );
}
