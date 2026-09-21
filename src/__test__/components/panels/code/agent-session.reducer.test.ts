import {
  applyDurableSessionEvent,
  durableEventsToTranscriptEntries,
  reduceAgentSessionPresentation,
} from "@/components/panels/code/components/AgentHarnessPanel/store/agent-session.reducer";
import { ChatRole } from "@/lib/generated/types.gen";
import type { AiSessionEvent } from "@/lib/generated/types.gen";

describe("agent session presentation reducer", () => {
  it("orders and deduplicates backend events before deriving the transcript", () => {
    const events = ([
      {
        event_id: "tool-result",
        sequence: 5,
        operation_id: "operation-1",
        occurred_at_ms: 5,
        kind: { type: "tool_result" as const, tool_call_id: "read", content: "contents", is_error: false },
      },
      {
        event_id: "reasoning",
        sequence: 6,
        operation_id: "operation-1",
        occurred_at_ms: 6,
        kind: { type: "reasoning" as const, content: "Now search." },
      },
      {
        event_id: "tool-call",
        sequence: 4,
        operation_id: "operation-1",
        occurred_at_ms: 4,
        kind: { type: "tool_call" as const, tool_call_id: "read", name: "read_file" },
      },
      {
        event_id: "user",
        sequence: 3,
        operation_id: "operation-1",
        occurred_at_ms: 3,
        kind: { type: "message" as const, role: ChatRole.USER, content: "Inspect this" },
      },
      {
        event_id: "queued",
        sequence: 2,
        operation_id: "operation-2",
        occurred_at_ms: 2,
        kind: { type: "user_message_queued" as const, content: "Then summarize" },
      },
    ] satisfies AiSessionEvent[]).reduce(applyDurableSessionEvent, [] as AiSessionEvent[]);

    expect(events.map((event) => event.event_id)).toEqual(["queued", "user", "tool-call", "tool-result", "reasoning"]);
    expect(applyDurableSessionEvent(events, { ...events[2]!, occurred_at_ms: 99 })).toHaveLength(5);

    const presentation = reduceAgentSessionPresentation(durableEventsToTranscriptEntries(events));
    expect(presentation.items.map((item) => item.kind)).toEqual(["entry", "tools", "entry"]);
    expect(presentation.pendingMessages.map((entry) => entry.id)).toEqual(["queued"]);
    expect(presentation.items[1]).toMatchObject({ kind: "tools", activities: [{ id: "read", status: "completed" }] });
  });

  it("uses a completed backend message ID to replace a streaming row", () => {
    const entries = durableEventsToTranscriptEntries([{
      event_id: "completed-event",
      sequence: 9,
      operation_id: "operation-1",
      occurred_at_ms: 9,
      kind: {
        type: "message",
        message_id: "operation-1:assistant:1",
        role: ChatRole.ASSISTANT,
        content: "Completed response",
      },
    }]);

    expect(entries).toMatchObject([{
      id: "operation-1:assistant:1",
      kind: "message",
      message: { id: "operation-1:assistant:1", text: "Completed response" },
    }]);
  });
});
