import { nanoid } from "nanoid";
import { create } from "zustand";
import { AgentConversation, AgentMessage, AgentModelSelection, ConversationStatus } from "../types/agent-harness.types";

const makeConversation = (): AgentConversation => ({
  id: nanoid(),
  title: "New conversation",
  createdAt: Date.now(),
  isOpen: true,
  model: null,
  status: "idle",
  messages: [],
});

type AgentHarnessState = {
  activeConversationId: string;
  conversations: AgentConversation[];
  createConversation: () => void;
  selectConversation: (id: string) => void;
  closeConversation: (id: string) => void;
  setModel: (id: string, model: AgentModelSelection | null) => void;
  addMessage: (id: string, message: AgentMessage) => void;
  appendMessageText: (conversationId: string, messageId: string, text: string) => void;
  setConversationStatus: (id: string, status: ConversationStatus) => void;
};
const initialConversation = makeConversation();

export const useAgentHarnessStore = create<AgentHarnessState>((set) => ({
  activeConversationId: initialConversation.id,
  conversations: [initialConversation],
  createConversation: () => {
    const conversation = makeConversation();
    set((state) => ({ activeConversationId: conversation.id, conversations: [...state.conversations, conversation] }));
  },
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
      if (!remaining.length) {
        const conversation = makeConversation();
        return { activeConversationId: conversation.id, conversations: [...conversations, conversation] };
      }
      return {
        activeConversationId: state.activeConversationId === id ? remaining.at(-1)!.id : state.activeConversationId,
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
              title:
                conversation.messages.length === 0 && message.text ? message.text.slice(0, 36) : conversation.title,
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
  setConversationStatus: (id, status) =>
    set((state) => ({
      conversations: state.conversations.map((conversation) =>
        conversation.id === id ? { ...conversation, status } : conversation,
      ),
    })),
}));
