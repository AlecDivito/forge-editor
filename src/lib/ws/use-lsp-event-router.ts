import { useEffect } from "react";
import { socket } from "./connection";
import { useLspRuntimeStore } from "@/store/lsp-runtime";

export function useLspEventRouter() {
  useEffect(() => {
    const unsubscribe = socket.subscribe((message) => {
      if (message.kind !== "LspServerEvent") return;
      useLspRuntimeStore.getState().route({
        workspaceId: message.workspace_id,
        languageId: message.language_id,
        method: message.method,
        params: message.params,
      });
    });
    return () => { unsubscribe(); };
  }, []);
}
