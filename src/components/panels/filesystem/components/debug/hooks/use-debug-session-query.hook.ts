import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { socket } from "@/lib/ws/connection";
import { getSessionOptions } from "@/lib/generated/@tanstack/react-query.gen";
import { WorkspaceId } from "@/lib/ws/messages";

export default function useDebugSessionQuery(workspaceId: WorkspaceId, sessionId?: string) {
  const options = getSessionOptions({ path: { workspace_id: workspaceId, session_id: sessionId ?? "" } });
  const client = useQueryClient();
  const query = useQuery({
    ...options,
    enabled: !!sessionId,
    retry: false,
    refetchInterval: false,
  });
  useEffect(() => {
    if (!sessionId) return;
    const attach = () => {
      const snapshot = client.getQueryData<typeof query.data>(options.queryKey);
      if (snapshot)
        socket.send({
          kind: "DebugAttach",
          workspace_id: workspaceId,
          session_id: sessionId,
          attachment_generation: snapshot.attachmentGeneration,
        });
    };
    attach();
    const unsubscribeConnection = socket.subscribeConnection(attach);
    const unsubscribe = socket.subscribe((message) => {
      if (
        message.kind === "DebugSnapshot" &&
        message.snapshot.workspaceId === workspaceId &&
        message.snapshot.sessionId === sessionId
      )
        client.setQueryData(options.queryKey, message.snapshot);
    });
    return () => {
      const snapshot = client.getQueryData<typeof query.data>(options.queryKey);
      if (snapshot)
        socket.send({
          kind: "DebugDetach",
          workspace_id: workspaceId,
          session_id: sessionId,
          attachment_generation: snapshot.attachmentGeneration,
        });
      unsubscribe();
      unsubscribeConnection();
    };
  }, [client, sessionId, workspaceId]);
  return query;
}
