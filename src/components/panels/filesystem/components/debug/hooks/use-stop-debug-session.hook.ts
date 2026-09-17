import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getSessionQueryKey, stopSessionMutation } from "@/lib/generated/@tanstack/react-query.gen";
import { WorkspaceId } from "@/lib/ws/messages";

export default function useStopDebugSession(workspaceId: WorkspaceId) {
  const queryClient = useQueryClient();
  return useMutation({
    ...stopSessionMutation(),
    onSuccess: (session) => {
      queryClient.setQueryData(getSessionQueryKey({ path: { workspace_id: workspaceId, session_id: session.sessionId } }), session);
    },
  });
}
