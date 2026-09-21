import { create } from "zustand";
import type { AiSessionEvent } from "@/lib/generated/types.gen";
import { applyDurableSessionEvent } from "./agent-session.reducer";
import {
  AgentConversation,
  AgentModelSelection,
  ConversationStatus,
} from "../types/agent-harness.types";

type AgentHarnessState = {
  activeConversationId: string | null;
  conversations: AgentConversation[];
  selectConversation: (id: string) => void;
  closeConversation: (id: string) => void;
  setModel: (id: string, model: AgentModelSelection | null) => void;
  setConversationTitle: (id: string, title: string) => void;
  setConversationStatus: (id: string, status: ConversationStatus) => void;
  setActiveRequestId: (id: string, requestId?: string) => void;
  applyDurableSessionEvent: (conversationId: string, event: AiSessionEvent) => void;
  appendStreamingText: (conversationId: string, requestId: string, messageId: string, text: string) => void;
  appendStreamingReasoning: (conversationId: string, requestId: string, reasoningId: string, text: string) => void;
  clearStreamingRequest: (conversationId: string, requestId: string) => void;
  hydrateSession: (conversation: AgentConversation) => void;
};

/**
 * UI state only: tab selection and ordered transcript events for sessions the
 * user has loaded. Restored JSONL and live WebSocket activity use the same
 * pure reducer, so neither path has its own conversation reconstruction.
 */
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
  closeConversation: (id) =>
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
    }),
  setModel: (id, model) =>
    set((state) => ({
      conversations: state.conversations.map((conversation) =>
        conversation.id === id ? { ...conversation, model } : conversation,
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
  setActiveRequestId: (id, activeRequestId) =>
    set((state) => ({
      conversations: state.conversations.map((conversation) =>
        conversation.id === id ? { ...conversation, activeRequestId } : conversation,
      ),
    })),
  applyDurableSessionEvent: (conversationId, event) =>
    set((state) => ({
      conversations: state.conversations.map((conversation) => {
        if (conversation.id !== conversationId) return conversation;
        const events = applyDurableSessionEvent(conversation.events, event);
        const streaming = { ...conversation.streaming };
        if (event.kind.type === "message") {
          const messageId = (event.kind as { message_id?: string }).message_id;
          if (messageId) delete streaming[messageId];
        }
        if (event.kind.type === "reasoning") {
          const reasoningId = (event.kind as { reasoning_id?: string }).reasoning_id;
          if (reasoningId) delete streaming[reasoningId];
        }
        return { ...conversation, events, streaming };
      }),
    })),
  appendStreamingText: (conversationId, requestId, messageId, text) =>
    set((state) => ({
      conversations: state.conversations.map((conversation) => {
        if (conversation.id !== conversationId) return conversation;
        const existing = conversation.streaming[messageId];
        const entry = existing?.kind === "message"
          ? { ...existing, message: { ...existing.message, text: `${existing.message.text}${text}` } }
          : { id: messageId, sequence: Number.MAX_SAFE_INTEGER, operationId: `operation-${requestId}`, kind: "message" as const, message: { id: messageId, role: "assistant" as const, text, createdAt: Date.now() } };
        return { ...conversation, streaming: { ...conversation.streaming, [messageId]: entry } };
      }),
    })),
  appendStreamingReasoning: (conversationId, requestId, reasoningId, text) =>
    set((state) => ({
      conversations: state.conversations.map((conversation) => {
        if (conversation.id !== conversationId) return conversation;
        const existing = conversation.streaming[reasoningId];
        const entry = existing?.kind === "reasoning"
          ? { ...existing, text: `${existing.text}${text}` }
          : { id: reasoningId, sequence: Number.MAX_SAFE_INTEGER, operationId: `operation-${requestId}`, kind: "reasoning" as const, text };
        return { ...conversation, streaming: { ...conversation.streaming, [reasoningId]: entry } };
      }),
    })),
  clearStreamingRequest: (conversationId, requestId) =>
    set((state) => ({
      conversations: state.conversations.map((conversation) => {
        if (conversation.id !== conversationId) return conversation;
        const streaming = Object.fromEntries(
          Object.entries(conversation.streaming).filter(([, entry]) => entry.operationId !== `operation-${requestId}`),
        );
        return { ...conversation, streaming };
      }),
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
