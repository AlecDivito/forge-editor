import { useMutation, useQueryClient } from "@tanstack/react-query";
import { SessionSnapshot } from "@/lib/generated";
import { createSessionMutation, getSessionQueryKey } from "@/lib/generated/@tanstack/react-query.gen";
import { WorkspaceId } from "@/lib/ws/messages";

export default function useCreateDebugSession(workspaceId: WorkspaceId, onCreated: (session: SessionSnapshot) => void, onError: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    ...createSessionMutation(),
    onSuccess: (session) => {
      queryClient.setQueryData(getSessionQueryKey({ path: { workspace_id: workspaceId, session_id: session.sessionId } }), session);
      onCreated(session);
    },
    onError,
  });
}
