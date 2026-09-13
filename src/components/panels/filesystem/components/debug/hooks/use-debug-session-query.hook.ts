import { useQuery } from "@tanstack/react-query";
import { getSessionOptions } from "@/lib/generated/@tanstack/react-query.gen";
import { WorkspaceId } from "@/lib/ws/messages";
import { isTerminalDebugState } from "./debug-session-state";

export default function useDebugSessionQuery(workspaceId: WorkspaceId, sessionId?: string) {
  return useQuery({
    ...getSessionOptions({ path: { workspace_id: workspaceId, session_id: sessionId ?? "" } }),
    enabled: !!sessionId,
    retry: false,
    refetchInterval: (query) => (isTerminalDebugState(query.state.data?.state) ? false : 350),
  });
}
