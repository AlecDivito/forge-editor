import { listSessionsQueryKey } from "@/lib/generated/@tanstack/react-query.gen";
import { socket } from "@/lib/ws/connection";
import { useQueryClient } from "@tanstack/react-query";
import { nanoid } from "nanoid";
import { useCallback, useEffect } from "react";
import { useAgentHarnessStore } from "../store/agent-harness.store";
import { AgentAttachment, AgentModelSelection } from "../types/agent-harness.types";

type StartChatInput = {
  conversationId: string;
  prompt: string;
  attachments: AgentAttachment[];
  model: AgentModelSelection;
};

/** Bridges transport events into the same event reducer used for loaded JSONL. */
export function useAgentChat() {
  const queryClient = useQueryClient();
  const applyDurableSessionEvent = useAgentHarnessStore((state) => state.applyDurableSessionEvent);
  const appendStreamingText = useAgentHarnessStore((state) => state.appendStreamingText);
  const appendStreamingReasoning = useAgentHarnessStore((state) => state.appendStreamingReasoning);
  const clearStreamingRequest = useAgentHarnessStore((state) => state.clearStreamingRequest);
  const setActiveRequestId = useAgentHarnessStore((state) => state.setActiveRequestId);
  const setConversationStatus = useAgentHarnessStore((state) => state.setConversationStatus);
  const setConversationTitle = useAgentHarnessStore((state) => state.setConversationTitle);

  useEffect(() => {
    const unsubscribe = socket.subscribe((message) => {
      switch (message.kind) {
        case "AgentSessionStarted":
          queryClient.invalidateQueries({ queryKey: listSessionsQueryKey() });
          break;
        case "AgentSessionEvent":
          applyDurableSessionEvent(message.conversation_id, message.event);
          if (message.event.kind.type === "session_named") {
            setConversationTitle(message.conversation_id, message.event.kind.title);
            queryClient.invalidateQueries({ queryKey: listSessionsQueryKey() });
          }
          break;
        case "AgentStarted":
          setConversationStatus(message.conversation_id, "streaming");
          setActiveRequestId(message.conversation_id, message.request_id);
          break;
        case "AgentTextDelta":
          appendStreamingText(message.conversation_id, message.request_id, message.message_id, message.text);
          break;
        case "AgentThinkingDelta":
          appendStreamingReasoning(message.conversation_id, message.request_id, message.reasoning_id, message.text);
          break;
        case "AgentToolStarted":
        case "AgentToolCompleted":
        case "AgentUsage":
          // Kept as transport lifecycle signals for compatibility. The
          // acknowledged AgentSessionEvent is the transcript source of truth.
          break;
        case "AgentSessionNamed":
          setConversationTitle(message.conversation_id, message.title);
          queryClient.invalidateQueries({ queryKey: listSessionsQueryKey() });
          break;
        case "AgentCompleted":
        case "AgentStopped":
          if (useAgentHarnessStore.getState().conversations.find((conversation) =>
            conversation.id === message.conversation_id,
          )?.activeRequestId !== message.request_id) {
            break;
          }
          setConversationStatus(message.conversation_id, "idle");
          setActiveRequestId(message.conversation_id, undefined);
          break;
        case "AgentError":
          if (useAgentHarnessStore.getState().conversations.find((conversation) =>
            conversation.id === message.conversation_id,
          )?.activeRequestId !== message.request_id) {
            break;
          }
          clearStreamingRequest(message.conversation_id, message.request_id);
          setConversationStatus(message.conversation_id, "idle");
          setActiveRequestId(message.conversation_id, undefined);
          break;
      }
    });
    return () => {
      unsubscribe();
    };
  }, [appendStreamingReasoning, appendStreamingText, applyDurableSessionEvent, clearStreamingRequest, queryClient, setActiveRequestId, setConversationStatus, setConversationTitle]);

  const startChat = useCallback(
    ({ conversationId, prompt, model }: StartChatInput) => {
      const requestId = nanoid();
      if (!socket.send({
        kind: "AgentPrompt",
        request_id: requestId,
        conversation_id: conversationId,
        provider: model.provider,
        model_id: model.id,
        prompt,
      })) {
        return null;
      }
      return requestId;
    },
    [],
  );

  const stopChat = useAgentStop();

  return { startChat, stopChat };
}

/** Sends an AgentStop command without subscribing to the chat event stream. */
export function useAgentStop() {
  return useCallback(
    (conversationId: string, requestId: string) =>
      socket.send({ kind: "AgentStop", conversation_id: conversationId, request_id: requestId }),
    [],
  );
}
