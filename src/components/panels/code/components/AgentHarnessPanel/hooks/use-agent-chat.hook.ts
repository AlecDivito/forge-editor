import { socket } from "@/lib/ws/connection";
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
  const addMessage = useAgentHarnessStore((state) => state.addMessage);
  const appendMessageText = useAgentHarnessStore((state) => state.appendMessageText);
  const setConversationStatus = useAgentHarnessStore((state) => state.setConversationStatus);

  useEffect(() => {
    const unsubscribe = socket.subscribe((message) => {
      switch (message.kind) {
        case "AgentStarted":
          setConversationStatus(message.conversation_id, "streaming");
          break;
        case "AgentTextDelta":
          appendMessageText(message.conversation_id, message.request_id, message.text);
          break;
        case "AgentCompleted":
          setConversationStatus(message.conversation_id, "idle");
          break;
        case "AgentError":
          appendMessageText(message.conversation_id, message.request_id, `\n\n${message.message}`);
          setConversationStatus(message.conversation_id, "idle");
          break;
      }
    });
    return () => {
      unsubscribe();
    };
  }, [appendMessageText, setConversationStatus]);

  const startChat = useCallback(
    ({ conversationId, prompt, attachments, model }: StartChatInput) => {
      const requestId = nanoid();
      addMessage(conversationId, { id: nanoid(), role: "user", text: prompt, attachments });

      if (!socket.send({ kind: "AgentSessionStart", request_id: nanoid(), conversation_id: conversationId })) {
        addMessage(conversationId, {
          id: requestId,
          role: "assistant",
          text: "Forge is not connected. Reconnect and try again.",
        });
        return false;
      }
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
