import { useQuery } from "@tanstack/react-query";
import { getSessionOptions } from "@/lib/generated/@tanstack/react-query.gen";
import { WorkspaceId } from "@/lib/ws/messages";

/** Reads the HTTP-created snapshot and subsequent WebSocket snapshots from the query cache. */
export default function useDebugSessionCache(workspaceId: WorkspaceId, sessionId?: string) {
  return useQuery({
    ...getSessionOptions({ path: { workspace_id: workspaceId, session_id: sessionId ?? "" } }),
    enabled: false,
  });
}
