import { create } from "zustand";
import { AgentConversation, AgentMessage, AgentModelSelection, ConversationStatus } from "../types/agent-harness.types";

type AgentHarnessState = {
  activeConversationId: string | null;
  conversations: AgentConversation[];
  selectConversation: (id: string) => void;
  closeConversation: (id: string) => void;
  setModel: (id: string, model: AgentModelSelection | null) => void;
  addMessage: (id: string, message: AgentMessage) => void;
  appendMessageText: (conversationId: string, messageId: string, text: string) => void;
  setConversationTitle: (id: string, title: string) => void;
  setConversationStatus: (id: string, status: ConversationStatus) => void;
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
        activeConversationId: state.activeConversationId === id ? (remaining.at(-1)?.id ?? null) : state.activeConversationId,
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
