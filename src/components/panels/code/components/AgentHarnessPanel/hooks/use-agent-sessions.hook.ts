import { listSessionsOptions } from "@/lib/generated/@tanstack/react-query.gen";
import { useQuery } from "@tanstack/react-query";
import { useAgentHarnessStore } from "../store/agent-harness.store";
import { AgentConversation } from "../types/agent-harness.types";

/** Loads the durable session summaries used by the history menu. */
export function useAgentSessions() {
  const query = useQuery({
    ...listSessionsOptions(),
    retry: false,
    staleTime: 30_000,
  });
  const conversations = useAgentHarnessStore((state) => state.conversations);
  const summaries = query.data ?? [];
  const localById = new Map(conversations.map((conversation) => [conversation.id, conversation]));
  const backendIds = new Set(summaries.map((summary) => summary.metadata.id));
  const historyConversations = summaries.map(
    (summary) =>
      localById.get(summary.metadata.id) ?? {
        id: summary.metadata.id,
        title: summary.metadata.title || "New conversation",
        createdAt: summary.metadata.created_at_ms,
        isOpen: false,
        model: summary.metadata.model
          ? {
              id: summary.metadata.model.model_id,
              label: summary.metadata.model.model_id,
              provider: summary.metadata.model.provider,
            }
          : null,
        status: "idle" as const,
        messages: [],
      },
  );
  const mergedConversations = [
    ...historyConversations,
    ...conversations.filter((conversation) => !backendIds.has(conversation.id)),
  ];
  return { ...query, historyConversations: mergedConversations, groups: groupConversations(mergedConversations) };
}

function groupConversations(conversations: AgentConversation[]) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const groups = new Map<string, AgentConversation[]>([
    ["Today", []],
    ["1 day ago", []],
    ["7 days ago", []],
    ["Remaining", []],
  ]);
  for (const conversation of conversations) {
    const created = new Date(conversation.createdAt);
    created.setHours(0, 0, 0, 0);
    const daysAgo = Math.floor((today.getTime() - created.getTime()) / 86_400_000);
    const label = daysAgo <= 0 ? "Today" : daysAgo === 1 ? "1 day ago" : daysAgo <= 7 ? "7 days ago" : "Remaining";
    groups.get(label)?.push(conversation);
  }
  return Array.from(groups, ([label, conversations]) => ({ label, conversations })).filter(
    (group) => group.conversations.length,
  );
}
