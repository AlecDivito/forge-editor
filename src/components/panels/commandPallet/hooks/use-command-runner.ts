import { useCallback } from "react";
import { useLspRuntimeStore } from "@/store/lsp-runtime";

export function useCommandRunner(close: () => void) {
  return useCallback(
    (command: () => void | Promise<void>) => {
      close();
      void Promise.resolve(command()).catch((error) => {
        useLspRuntimeStore.getState().notify(error instanceof Error ? error.message : String(error));
      });
    },
    [close],
  );
}
