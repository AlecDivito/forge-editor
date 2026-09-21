import { AgentTokenUsage, AgentToolActivity, AgentTranscriptEntry } from "../types/agent-harness.types";
import type { AiSessionEvent, AiTokenUsage } from "@/lib/generated/types.gen";

function tokenUsage(usage: AiTokenUsage | null | undefined): AgentTokenUsage | undefined {
  if (!usage) return undefined;
  return {
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
    cachedTokens: usage.cached_tokens ?? undefined,
    reasoningTokens: usage.reasoning_tokens ?? undefined,
  };
}

/** Converts the canonical durable protocol into the UI's presentation rows. */
export function durableEventsToTranscriptEntries(events: AiSessionEvent[]): AgentTranscriptEntry[] {
  return events.flatMap((event): AgentTranscriptEntry[] => {
    const operationId = event.operation_id ?? undefined;
    const kind = event.kind;
    switch (kind.type) {
      case "message":
        const messageId = (kind as { message_id?: string | null }).message_id ?? event.event_id;
        return [{
          id: messageId,
          sequence: event.sequence,
          operationId,
          kind: "message",
          message: {
            id: messageId,
            role: kind.role,
            text: kind.content,
            thinking: kind.thinking ?? undefined,
            createdAt: event.occurred_at_ms,
            usage: tokenUsage(kind.usage),
          },
        }];
      case "reasoning":
        return [{ id: (kind as { reasoning_id?: string | null }).reasoning_id ?? event.event_id, sequence: event.sequence, operationId, kind: "reasoning", text: kind.content }];
      case "user_message_queued":
        return [{
          id: event.event_id,
          sequence: event.sequence,
          operationId,
          kind: "pending-message",
          message: { id: event.event_id, role: "user", text: kind.content, createdAt: event.occurred_at_ms },
        }];
      case "tool_call":
        return [{
          id: event.event_id,
          sequence: event.sequence,
          operationId,
          kind: "tool-call",
          activity: {
            id: kind.tool_call_id,
            requestId: "",
            name: kind.name,
            arguments: (kind as { arguments?: unknown }).arguments ?? {},
            createdAt: event.occurred_at_ms,
            status: "running",
          },
        }];
      case "tool_result":
        return [{
          id: event.event_id,
          sequence: event.sequence,
          operationId,
          kind: "tool-result",
          toolCallId: kind.tool_call_id,
          text: kind.content,
          isError: kind.is_error,
        }];
      case "failure":
        return [{ id: event.event_id, sequence: event.sequence, operationId, kind: "failure", text: kind.message }];
      default:
        return [];
    }
  });
}

/** Inserts a committed record exactly once and restores its server sequence. */
export function applyDurableSessionEvent(events: AiSessionEvent[], event: AiSessionEvent): AiSessionEvent[] {
  const withoutCurrent = events.filter((existing) => existing.event_id !== event.event_id);
  return [...withoutCurrent, event].sort((left, right) => left.sequence - right.sequence);
}

export type AgentPresentationItem =
  | { kind: "entry"; entry: AgentTranscriptEntry }
  | { kind: "tools"; key: string; activities: AgentToolActivity[] };

export type AgentSessionPresentation = {
  items: AgentPresentationItem[];
  pendingMessages: AgentTranscriptEntry[];
};

/**
 * Frontend counterpart to the Rust session reducer. It has no Zustand
 * dependency: ordered events in, presentation rows out. Tool results fold
 * into their calls, and only directly adjacent calls form a visual batch.
 */
export function reduceAgentSessionPresentation(entries: AgentTranscriptEntry[]): AgentSessionPresentation {
  const items: AgentPresentationItem[] = [];
  const pending = new Map<string, AgentTranscriptEntry>();
  const results = new Map(
    entries.flatMap((entry) => entry.kind === "tool-result" ? [[entry.toolCallId, entry] as const] : []),
  );
  for (const entry of entries) {
    if (entry.kind === "pending-message") {
      pending.set(entry.operationId ?? entry.id, entry);
      continue;
    }
    if (entry.kind === "message" && entry.message.role === "user") {
      pending.delete(entry.operationId ?? entry.id);
    }
    if (entry.kind === "tool-result") continue;
    if (entry.kind === "tool-call") {
      const result = results.get(entry.activity.id);
      const activity = result
        ? { ...entry.activity, status: result.isError ? "error" as const : "completed" as const }
        : entry.activity;
      const previous = items.at(-1);
      if (previous?.kind === "tools") {
        previous.activities.push(activity);
      } else {
        items.push({ kind: "tools", key: `tools-${entry.id}`, activities: [activity] });
      }
      continue;
    }
    items.push({ kind: "entry", entry });
  }
  return { items, pendingMessages: [...pending.values()] };
}
