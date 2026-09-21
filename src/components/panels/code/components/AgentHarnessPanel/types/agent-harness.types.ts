import type { AiSessionEvent } from "@/lib/generated/types.gen";

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
  thinking?: string;
  errorCode?: string;
  createdAt: number;
  attachments?: AgentAttachment[];
  usage?: AgentTokenUsage;
};

export type AgentTokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens?: number;
  reasoningTokens?: number;
};
/** `recovering` is derived from a durable nonterminal operation loaded from
 * JSONL. It becomes `streaming` once this browser observes AgentStarted. */
export type ConversationStatus = "idle" | "streaming" | "recovering";

export type AgentToolActivity = {
  id: string;
  requestId: string;
  name: string;
  arguments: unknown;
  createdAt: number;
  status: "running" | "completed" | "error";
};

/** A single ordered durable row. Restored sessions use this instead of trying
 * to reconstruct chronology from separate message and tool collections. */
export type AgentTranscriptEntry =
  | { id: string; sequence: number; operationId?: string; kind: "message"; message: AgentMessage }
  | { id: string; sequence: number; operationId?: string; kind: "reasoning"; text: string }
  | { id: string; sequence: number; operationId?: string; kind: "pending-message"; message: AgentMessage }
  | { id: string; sequence: number; operationId?: string; kind: "tool-call"; activity: AgentToolActivity }
  | { id: string; sequence: number; operationId?: string; kind: "tool-result"; toolCallId: string; text: string; isError: boolean }
  | { id: string; sequence: number; operationId?: string; kind: "failure"; text: string }
  | { id: string; sequence: number; operationId?: string; kind: "status"; text: string };

/** A model identity is provider-scoped; its display label is never used as an API identifier. */
export type AgentModelSelection = {
  id: string;
  label: string;
  provider: string;
};

export type AgentConversation = {
  id: string;
  title: string;
  createdAt: number;
  isOpen: boolean;
  model: AgentModelSelection | null;
  status: ConversationStatus;
  activeRequestId?: string;
  events: AiSessionEvent[];
  streaming: Record<string, AgentTranscriptEntry>;
};
