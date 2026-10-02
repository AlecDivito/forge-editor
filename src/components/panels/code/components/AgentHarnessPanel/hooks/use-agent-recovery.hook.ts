import { nanoid } from "nanoid";
import { useEffect, useRef } from "react";
import { socket } from "@/lib/ws/connection";
import { useAgentHarnessStore } from "../store/agent-harness.store";
import { useAgentSession } from "./use-agent-session.hook";

const LAST_CONVERSATION_KEY = "forge.agent.last-conversation-id";

/**
 * Persists only the selected session ID—not transcript state. A refresh
 * rehydrates the canonical session from the backend, then reattaches its
 * WebSocket stream through `useAgentSession`.
 */
export function useAgentRecovery() {
  const activeConversationId = useAgentHarnessStore((state) => state.activeConversationId);
  const { mutate: restore } = useAgentSession();
  const restored = useRef(false);
  const activeConversationRef = useRef<string | null>(null);

  useEffect(() => {
    activeConversationRef.current = activeConversationId;
  }, [activeConversationId]);

  useEffect(() => {
    if (activeConversationId) {
      window.localStorage.setItem(LAST_CONVERSATION_KEY, activeConversationId);
    }
  }, [activeConversationId]);

  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const conversationId = window.localStorage.getItem(LAST_CONVERSATION_KEY);
    if (conversationId) restore(conversationId);
  }, [restore]);

  useEffect(() => {
    const unsubscribe = socket.subscribeConnection(() => {
      const conversationId = activeConversationRef.current;
      if (!conversationId) return;
      socket.send({
        kind: "AgentSessionStart",
        request_id: nanoid(),
        conversation_id: conversationId,
      });
    });
    return () => { unsubscribe(); };
  }, []);
}
