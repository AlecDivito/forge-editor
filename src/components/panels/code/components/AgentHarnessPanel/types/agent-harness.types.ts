export type AgentAttachment = {
  id: string;
  name: string;
  mimeType: string;
  previewUrl: string;
};
export type AgentMessage = {
  id: string;
  role: "assistant" | "user" | "tool";
  text: string;
  attachments?: AgentAttachment[];
};
export type ConversationStatus = "idle" | "streaming";

/** A model identity is provider-scoped; its display label is never used as an API identifier. */
export type AgentModelSelection = {
  id: string;
  label: string;
  provider: string;
};

/** The provider/model portion of the future AgentPrompt WebSocket operation. */
export type AgentProcessingRequest = {
  conversationId: string;
  prompt: string;
  model: {
    id: string;
    provider: string;
  };
  attachments: AgentAttachment[];
};

export type AgentConversation = {
  id: string;
  title: string;
  createdAt: number;
  isOpen: boolean;
  model: AgentModelSelection | null;
  status: ConversationStatus;
  messages: AgentMessage[];
};
