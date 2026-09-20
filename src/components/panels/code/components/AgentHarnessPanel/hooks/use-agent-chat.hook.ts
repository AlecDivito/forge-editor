import { socket } from "@/lib/ws/connection";
import { listSessionsQueryKey } from "@/lib/generated/@tanstack/react-query.gen";
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

export function useAgentChat() {
  const queryClient = useQueryClient();
  const addMessage = useAgentHarnessStore((state) => state.addMessage);
  const appendMessageText = useAgentHarnessStore((state) => state.appendMessageText);
  const setConversationStatus = useAgentHarnessStore((state) => state.setConversationStatus);
  const setConversationTitle = useAgentHarnessStore((state) => state.setConversationTitle);
  const startToolActivity = useAgentHarnessStore((state) => state.startToolActivity);
  const completeToolActivity = useAgentHarnessStore((state) => state.completeToolActivity);
  const failRunningToolActivities = useAgentHarnessStore((state) => state.failRunningToolActivities);

  useEffect(() => {
    const unsubscribe = socket.subscribe((message) => {
      switch (message.kind) {
        case "AgentSessionStarted":
          queryClient.invalidateQueries({ queryKey: listSessionsQueryKey() });
          break;
        case "AgentStarted":
          setConversationStatus(message.conversation_id, "streaming");
          break;
        case "AgentTextDelta":
          appendMessageText(message.conversation_id, message.request_id, message.text);
          break;
        case "AgentToolStarted":
          startToolActivity(message.conversation_id, {
            id: message.tool_call_id,
            requestId: message.request_id,
            name: message.name,
            arguments: message.arguments,
          });
          break;
        case "AgentToolCompleted":
          completeToolActivity(message.conversation_id, message.tool_call_id, message.is_error);
          break;
        case "AgentSessionNamed":
          setConversationTitle(message.conversation_id, message.title);
          queryClient.invalidateQueries({ queryKey: listSessionsQueryKey() });
          break;
        case "AgentCompleted":
          setConversationStatus(message.conversation_id, "idle");
          break;
        case "AgentError":
          appendMessageText(message.conversation_id, message.request_id, message.message);
          failRunningToolActivities(message.conversation_id, message.request_id);
          setConversationStatus(message.conversation_id, "idle");
          break;
      }
    });
    return () => {
      unsubscribe();
    };
  }, [
    appendMessageText,
    completeToolActivity,
    failRunningToolActivities,
    queryClient,
    setConversationStatus,
    setConversationTitle,
    startToolActivity,
  ]);

  const startChat = useCallback(
    ({ conversationId, prompt, attachments, model }: StartChatInput) => {
      const requestId = nanoid();
      addMessage(conversationId, { id: nanoid(), role: "user", text: prompt, attachments });

      if (
        !socket.send({
          kind: "AgentPrompt",
          request_id: requestId,
          conversation_id: conversationId,
          provider: model.provider,
          model_id: model.id,
          prompt,
        })
      ) {
        addMessage(conversationId, {
          id: requestId,
          role: "assistant",
          text: "Forge disconnected before the prompt could be sent.",
        });
        return false;
      }
      addMessage(conversationId, { id: requestId, role: "assistant", text: "" });
      setConversationStatus(conversationId, "streaming");
      return true;
    },
    [addMessage, setConversationStatus],
  );

  return { startChat };
}
