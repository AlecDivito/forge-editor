import { listSessionsQueryKey } from "@/lib/generated/@tanstack/react-query.gen";
import { socket } from "@/lib/ws/connection";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { nanoid } from "nanoid";
import { useAgentSession } from "./use-agent-session.hook";

type PendingSession = {
  conversationId: string;
  onCreated?: (conversationId: string) => void;
};

/** Creates a durable session before exposing it as an open conversation tab. */
export function useCreateAgentSession() {
  const queryClient = useQueryClient();
  const { mutate: loadSession } = useAgentSession();
  const pending = useRef(new Map<string, PendingSession>());
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    const unsubscribe = socket.subscribe((message) => {
      if (message.kind === "AgentSessionStarted") {
        const pendingSession = pending.current.get(message.request_id);
        if (!pendingSession) return;
        pending.current.delete(message.request_id);
        queryClient.invalidateQueries({ queryKey: listSessionsQueryKey() });
        loadSession(pendingSession.conversationId, {
          onSuccess: () => {
            setIsCreating(pending.current.size > 0);
            pendingSession.onCreated?.(pendingSession.conversationId);
          },
          onError: () => setIsCreating(pending.current.size > 0),
        });
      }
      if (message.kind === "AgentError" && pending.current.has(message.request_id)) {
        pending.current.delete(message.request_id);
        setIsCreating(pending.current.size > 0);
      }
    });
    return () => {
      unsubscribe();
    };
  }, [loadSession, queryClient]);

  const createSession = useCallback((onCreated?: (conversationId: string) => void) => {
    const requestId = nanoid();
    const conversationId = nanoid();
    if (!socket.send({ kind: "AgentSessionStart", request_id: requestId, conversation_id: conversationId })) {
      return false;
    }
    pending.current.set(requestId, { conversationId, onCreated });
    setIsCreating(true);
    return true;
  }, []);

  return { createSession, isCreating };
}
