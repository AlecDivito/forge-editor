import { create } from "zustand";
import {
  AgentConversation,
  AgentMessage,
  AgentModelSelection,
  AgentTokenUsage,
  AgentToolActivity,
  ConversationStatus,
} from "../types/agent-harness.types";

type AgentHarnessState = {
  activeConversationId: string | null;
  conversations: AgentConversation[];
  selectConversation: (id: string) => void;
  closeConversation: (id: string) => void;
  setModel: (id: string, model: AgentModelSelection | null) => void;
  addMessage: (id: string, message: AgentMessage) => void;
  appendMessageText: (conversationId: string, messageId: string, text: string) => void;
  setMessageUsage: (conversationId: string, messageId: string, usage: AgentTokenUsage) => void;
  setConversationTitle: (id: string, title: string) => void;
  setConversationStatus: (id: string, status: ConversationStatus) => void;
  startToolActivity: (conversationId: string, activity: Omit<AgentToolActivity, "status">) => void;
  completeToolActivity: (conversationId: string, toolCallId: string, isError: boolean) => void;
  failRunningToolActivities: (conversationId: string, requestId: string) => void;
  hydrateSession: (conversation: AgentConversation) => void;
};

export const useAgentHarnessStore = create<AgentHarnessState>((set) => ({
  activeConversationId: null,
  conversations: [],
  selectConversation: (activeConversationId) =>
    set((state) => ({
      activeConversationId,
      conversations: state.conversations.map((conversation) =>
        conversation.id === activeConversationId ? { ...conversation, isOpen: true } : conversation,
      ),
    })),
  closeConversation: (id) => {
    set((state) => {
      const conversations = state.conversations.map((conversation) =>
        conversation.id === id ? { ...conversation, isOpen: false } : conversation,
      );
      const remaining = conversations.filter((conversation) => conversation.isOpen);
      return {
        activeConversationId:
          state.activeConversationId === id ? (remaining.at(-1)?.id ?? null) : state.activeConversationId,
        conversations,
      };
    });
  },
  setModel: (id, model) =>
    set((state) => ({
      conversations: state.conversations.map((conversation) =>
        conversation.id === id ? { ...conversation, model } : conversation,
      ),
    })),
  addMessage: (id, message) =>
    set((state) => ({
      conversations: state.conversations.map((conversation) =>
        conversation.id !== id
          ? conversation
          : {
              ...conversation,
              messages: [...conversation.messages, message],
            },
      ),
    })),
  appendMessageText: (conversationId, messageId, text) =>
    set((state) => ({
      conversations: state.conversations.map((conversation) =>
        conversation.id !== conversationId
          ? conversation
          : {
              ...conversation,
              messages: conversation.messages.map((message) =>
                message.id === messageId ? { ...message, text: `${message.text}${text}` } : message,
              ),
            },
      ),
    })),
  setMessageUsage: (conversationId, messageId, usage) =>
    set((state) => ({
      conversations: state.conversations.map((conversation) =>
        conversation.id !== conversationId
          ? conversation
          : {
              ...conversation,
              messages: conversation.messages.map((message) =>
                message.id === messageId ? { ...message, usage } : message,
              ),
            },
      ),
    })),
  setConversationTitle: (id, title) =>
    set((state) => ({
      conversations: state.conversations.map((conversation) =>
        conversation.id === id ? { ...conversation, title } : conversation,
      ),
    })),
  setConversationStatus: (id, status) =>
    set((state) => ({
      conversations: state.conversations.map((conversation) =>
        conversation.id === id ? { ...conversation, status } : conversation,
      ),
    })),
  startToolActivity: (conversationId, activity) =>
    set((state) => ({
      conversations: state.conversations.map((conversation) =>
        conversation.id !== conversationId
          ? conversation
          : {
              ...conversation,
              toolActivities: [
                ...conversation.toolActivities.filter((item) => item.id !== activity.id),
                { ...activity, status: "running" },
              ],
            },
      ),
    })),
  completeToolActivity: (conversationId, toolCallId, isError) =>
    set((state) => ({
      conversations: state.conversations.map((conversation) =>
        conversation.id !== conversationId
          ? conversation
          : {
              ...conversation,
              toolActivities: conversation.toolActivities.map((activity) =>
                activity.id === toolCallId ? { ...activity, status: isError ? "error" : "completed" } : activity,
              ),
            },
      ),
    })),
  failRunningToolActivities: (conversationId, requestId) =>
    set((state) => ({
      conversations: state.conversations.map((conversation) =>
        conversation.id !== conversationId
          ? conversation
          : {
              ...conversation,
              toolActivities: conversation.toolActivities.map((activity) =>
                activity.requestId === requestId && activity.status === "running"
                  ? { ...activity, status: "error" }
                  : activity,
              ),
            },
      ),
    })),
  hydrateSession: (conversation) =>
    set((state) => {
      const exists = state.conversations.some((item) => item.id === conversation.id);
      return {
        activeConversationId: conversation.id,
        conversations: exists
          ? state.conversations.map((item) => (item.id === conversation.id ? conversation : item))
          : [...state.conversations, conversation],
      };
    }),
}));
