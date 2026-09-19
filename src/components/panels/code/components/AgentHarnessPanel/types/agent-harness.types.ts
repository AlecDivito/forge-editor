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
export type AgentConversation = {
  id: string;
  title: string;
  createdAt: number;
  isOpen: boolean;
  model: string;
  status: ConversationStatus;
  messages: AgentMessage[];
};

export const agentModels = [
  { id: "default", label: "Choose a model" },
  { id: "claude-sonnet", label: "Claude Sonnet" },
  { id: "gpt-5", label: "GPT-5" },
] as const;
