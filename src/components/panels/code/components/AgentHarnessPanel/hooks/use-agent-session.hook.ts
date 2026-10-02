import { getSessionOptions } from "@/lib/generated/@tanstack/react-query.gen";
import type { AgentSessionLog } from "@/lib/generated/types.gen";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { OperationStatus } from "@/lib/generated/types.gen";
import { socket } from "@/lib/ws/connection";
import { nanoid } from "nanoid";
import { useAgentHarnessStore } from "../store/agent-harness.store";
import { AgentConversation } from "../types/agent-harness.types";

const toConversation = (session: AgentSessionLog): AgentConversation => {
  const events = session.events ?? [];
  const activeOperation = (session.operations ?? []).find(
    (operation) => operation.status !== OperationStatus.COMPLETE,
  );
  return {
    id: session.metadata.id,
    title: session.metadata.title || "New conversation",
    createdAt: session.metadata.created_at_ms,
    isOpen: true,
    model: session.metadata.model
      ? {
          id: session.metadata.model.model_id,
          label: session.metadata.model.model_id,
          provider: session.metadata.model.provider,
        }
      : null,
    status: activeOperation ? "recovering" : "idle",
    activeRequestId: activeOperation?.request_id,
    events,
    streaming: {},
  };
};

/** Restores one durable conversation into the local harness store on demand. */
export function useAgentSession() {
  const queryClient = useQueryClient();
  const hydrateSession = useAgentHarnessStore((state) => state.hydrateSession);
  return useMutation({
    mutationFn: (sessionId: string) =>
      queryClient.query({
        ...getSessionOptions({ path: { session_id: sessionId } }),
        staleTime: 30_000,
      }),
    onSuccess: (session) => {
      hydrateSession(toConversation(session));
      // REST supplies the complete durable snapshot. This starts/reattaches
      // the server-side session actor so subsequent committed events and
      // ephemeral deltas continue over this browser's current socket.
      socket.send({
        kind: "AgentSessionStart",
        request_id: nanoid(),
        conversation_id: session.metadata.id,
      });
    },
  });
}
