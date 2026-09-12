import { socket } from "@/lib/ws/connection";
import { TerminalId, WorkspaceId } from "@/lib/ws/messages";
import { useCallback, useEffect } from "react";

export default function useTerminal(workspaceId: WorkspaceId, terminalId: TerminalId) {
  useEffect(() => {
    const unsubscribe = socket.subscribe((msg) => {
      if (msg.kind === "TerminalOutput" && msg.workspace_id === workspaceId && msg.terminal_id === terminalId) {
        console.log(`terminal output ${msg.data}`);
      }
    });
    return () => {
      unsubscribe();
    };
  }, [workspaceId, terminalId]);

  const write = useCallback(
    (data: Uint8Array) => {
      socket.send({
        kind: "TerminalInput",
        workspace_id: workspaceId,
        terminal_id: terminalId,
        data: Array.from(data),
      });
    },
    [workspaceId, terminalId],
  );

  return { write };
}
