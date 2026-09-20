import { getSessionOptions } from "@/lib/generated/@tanstack/react-query.gen";
import type { AiSession, AiTokenUsage } from "@/lib/generated/types.gen";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { nanoid } from "nanoid";
import { useAgentHarnessStore } from "../store/agent-harness.store";
import { AgentConversation, AgentTokenUsage } from "../types/agent-harness.types";

function toTokenUsage(usage: AiTokenUsage | null | undefined): AgentTokenUsage | undefined {
  if (!usage) return undefined;
  return {
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
    cachedTokens: usage.cached_tokens ?? undefined,
    reasoningTokens: usage.reasoning_tokens ?? undefined,
  };
}

const toConversation = (session: AiSession): AgentConversation => ({
  id: session.metadata.id,
  title: session.metadata.title || "New conversation",
  createdAt: session.metadata.created_at_ms,
  isOpen: true,
  model: session.metadata.model
    ? {
        id: session.metadata.model.model_id,
        label: session.metadata.model.model_id,
        provider: session.metadata.model.provider,
      }
    : null,
  status: "idle",
  messages: session.messages.map((message) => ({
    id: nanoid(),
    role: message.role,
    text: message.content,
    usage: toTokenUsage(message.usage),
  })),
  toolActivities: [],
});

/** Restores one durable conversation into the local harness store on demand. */
export function useAgentSession() {
  const queryClient = useQueryClient();
  const hydrateSession = useAgentHarnessStore((state) => state.hydrateSession);
  return useMutation({
    mutationFn: (sessionId: string) =>
      queryClient.query({
        ...getSessionOptions({ path: { session_id: sessionId } }),
        staleTime: 30_000,
      }),
    onSuccess: (session) => {
      hydrateSession(toConversation(session));
    },
  });
}
