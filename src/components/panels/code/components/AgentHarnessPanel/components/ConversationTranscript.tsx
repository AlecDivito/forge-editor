import { Bubble, BubbleContent } from "@/components/ui/bubble";
import {
  Attachment,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import { Message, MessageContent } from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { Brain, Loader2, Wrench } from "lucide-react";
import { ToolActivityTimeline } from "./ToolActivityTimeline";
import { durableEventsToTranscriptEntries, reduceAgentSessionPresentation } from "../store/agent-session.reducer";
import { useAgentHarnessStore } from "../store/agent-harness.store";
import { useAgentStop } from "../hooks/use-agent-chat.hook";
import { AgentMessage, AgentTranscriptEntry } from "../types/agent-harness.types";

function formatTokens(tokens: number) {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(tokens);
}

function MessageUsage({ message }: { message: AgentMessage }) {
  if (!message.usage || message.role !== "assistant") return null;
  const { promptTokens, completionTokens, reasoningTokens, totalTokens } = message.usage;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[10px] text-muted-foreground">
      <span>{formatTokens(totalTokens)} tokens</span>
      <span>{formatTokens(promptTokens)} in</span>
      <span>{formatTokens(completionTokens)} out</span>
      {reasoningTokens ? <span>{formatTokens(reasoningTokens)} reasoning</span> : null}
    </div>
  );
}

function TranscriptMessage({ message }: { message: AgentMessage }) {
  if (message.role === "tool")
    return (
      <Marker variant="border" className="px-3 py-2 text-xs">
        <MarkerIcon>
          <Wrench className="size-3.5" />
        </MarkerIcon>
        <MarkerContent>{message.text}</MarkerContent>
      </Marker>
    );
  const user = message.role === "user";
  return (
    <Message align={user ? "end" : "start"}>
      <MessageContent>
        <Bubble variant={user ? "default" : message.errorCode ? "destructive" : "ghost"}>
          {message.attachments?.length ? (
            <AttachmentGroup className="pb-1.5">
              {message.attachments.map((attachment) => (
                <Attachment key={attachment.id} orientation="vertical" size="sm">
                  <AttachmentMedia variant="image">
                    <img src={attachment.previewUrl} alt={attachment.name} />
                  </AttachmentMedia>
                  <AttachmentContent>
                    <AttachmentTitle>{attachment.name}</AttachmentTitle>
                    <AttachmentDescription>{attachment.mimeType}</AttachmentDescription>
                  </AttachmentContent>
                </Attachment>
              ))}
            </AttachmentGroup>
          ) : null}
          {message.text ? <BubbleContent className="whitespace-pre-wrap">{message.text}</BubbleContent> : null}
          {message.thinking ? (
            <details className="mt-2 rounded-md border border-border/60 bg-muted/30 px-2 py-1.5 text-xs text-muted-foreground" open={!message.text}>
              <summary className="cursor-pointer font-medium text-foreground/75">Reasoning</summary>
              <div className="mt-1 whitespace-pre-wrap">{message.thinking}</div>
            </details>
          ) : null}
          <MessageUsage message={message} />
          {message.errorCode ? <div className="mt-1 text-[10px] font-medium uppercase tracking-wide opacity-70">{message.errorCode.replaceAll("_", " ")}</div> : null}
        </Bubble>
      </MessageContent>
    </Message>
  );
}

function DurableEntry({ entry }: { entry: AgentTranscriptEntry }) {
  switch (entry.kind) {
    case "message":
      return <TranscriptMessage message={entry.message} />;
    case "reasoning":
      return (
        <details className="rounded-md border border-border/60 bg-muted/25 px-2.5 py-2 text-xs text-muted-foreground">
          <summary className="flex cursor-pointer list-none items-center gap-2 font-medium text-foreground/75">
            <Brain className="size-3.5" />
            Reasoning
          </summary>
          <div className="mt-2 whitespace-pre-wrap">{entry.text}</div>
        </details>
      );
    case "tool-call":
      return <ToolActivityTimeline activities={[entry.activity]} />;
    case "tool-result":
      return (
        <Marker variant={entry.isError ? "border" : "default"} className="px-3 py-2 text-xs">
          <MarkerIcon>
            <Wrench className="size-3.5" />
          </MarkerIcon>
          <MarkerContent>{entry.isError ? `Tool failed: ${entry.text}` : entry.text || "Tool completed"}</MarkerContent>
        </Marker>
      );
    case "failure":
      return <Marker variant="border" className="px-3 py-2 text-xs text-destructive"><MarkerContent>{entry.text}</MarkerContent></Marker>;
    case "pending-cancelled":
      return <Marker className="px-3 py-2 text-xs text-muted-foreground"><MarkerContent>Queued message cancelled: {entry.text}</MarkerContent></Marker>;
    case "status":
      return <Marker className="px-3 py-1 text-[10px] text-muted-foreground"><MarkerContent>{entry.text}</MarkerContent></Marker>;
  }
}

export function ConversationTranscript() {
  const activeConversationId = useAgentHarnessStore((state) => state.activeConversationId);
  const conversation = useAgentHarnessStore((state) =>
    state.conversations.find((item) => item.id === activeConversationId),
  );
  const editQueuedPrompt = useAgentHarnessStore((state) => state.editQueuedPrompt);
  const stopChat = useAgentStop();
  const isWorking = conversation?.status !== undefined && conversation.status !== "idle";
  const presentation = reduceAgentSessionPresentation([
    ...durableEventsToTranscriptEntries(conversation?.events ?? []),
    ...Object.values(conversation?.streaming ?? {}),
  ]);
  return (
    <MessageScrollerProvider autoScroll defaultScrollPosition="last-anchor" scrollPreviousItemPeek={48}>
      <MessageScroller className="flex-1">
        <MessageScrollerViewport className="px-3 py-4">
          <MessageScrollerContent className="mx-auto w-full max-w-2xl gap-4" aria-busy={isWorking}>
            {presentation.items.map((item) =>
              item.kind === "tools" ? (
                <MessageScrollerItem key={item.key} messageId={item.key} className="px-1">
                  <ToolActivityTimeline activities={item.activities} />
                </MessageScrollerItem>
              ) : (
                <MessageScrollerItem
                  key={item.entry.id}
                  messageId={item.entry.id}
                  scrollAnchor={item.entry.kind === "message" && item.entry.message.role === "user"}>
                  <DurableEntry entry={item.entry} />
                </MessageScrollerItem>
              ),
            )}
            {isWorking && (
              <MessageScrollerItem messageId="streaming" className="px-1">
                <Marker aria-live="polite" className="text-xs">
                  <MarkerIcon>
                    <Loader2 className="size-3.5 animate-spin" />
                  </MarkerIcon>
                  <MarkerContent className="animate-pulse">
                    {conversation?.status === "recovering" ? "Resuming work in the background…" : "Generating response…"}
                  </MarkerContent>
                </Marker>
              </MessageScrollerItem>
            )}
            {presentation.pendingMessages.map((entry) =>
              entry.kind === "pending-message" ? (
                <MessageScrollerItem key={entry.id} messageId={entry.id} scrollAnchor>
                  <div className="space-y-1.5 opacity-60">
                    <div className="flex justify-end gap-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      <span>Queued</span>
                      <button
                        type="button"
                        className="hover:text-foreground"
                        onClick={() => {
                          if (!conversation || !entry.requestId) return;
                          if (stopChat(conversation.id, entry.requestId)) {
                            editQueuedPrompt(entry.requestId, entry.message.text);
                          }
                        }}>
                        Edit
                      </button>
                    </div>
                    <TranscriptMessage message={entry.message} />
                  </div>
                </MessageScrollerItem>
              ) : null,
            )}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  );
}
