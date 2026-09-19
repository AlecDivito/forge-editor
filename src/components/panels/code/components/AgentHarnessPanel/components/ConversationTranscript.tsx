import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Message, MessageAvatar, MessageContent } from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { Loader2, Sparkles, Wrench } from "lucide-react";
import { useAgentHarnessStore } from "../store/agent-harness.store";
import { AgentMessage } from "../types/agent-harness.types";

function TranscriptMessage({ message }: { message: AgentMessage }) {
  if (message.role === "tool")
    return (
      <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <Wrench className="size-3.5" />
        {message.text}
      </div>
    );
  const user = message.role === "user";
  return (
    <Message align={user ? "end" : "start"}>
      {!user && (
        <MessageAvatar className="size-6 rounded-md bg-primary/10 text-primary">
          <Sparkles className="size-3.5" />
        </MessageAvatar>
      )}
      <MessageContent>
        <Bubble variant={user ? "default" : "ghost"}>
          {message.attachments?.length ? (
            <div className="grid grid-cols-2 gap-1.5 pb-1.5">
              {message.attachments.map((attachment) => (
                <img
                  key={attachment.id}
                  src={attachment.previewUrl}
                  alt={attachment.name}
                  className="aspect-square w-full rounded-2xl object-cover"
                />
              ))}
            </div>
          ) : null}
          {message.text ? <BubbleContent>{message.text}</BubbleContent> : null}
        </Bubble>
      </MessageContent>
    </Message>
  );
}

export function ConversationTranscript() {
  const activeConversationId = useAgentHarnessStore((state) => state.activeConversationId);
  const conversation = useAgentHarnessStore((state) =>
    state.conversations.find((item) => item.id === activeConversationId),
  );
  if (!conversation) return null;
  return (
    <MessageScrollerProvider autoScroll defaultScrollPosition="last-anchor" scrollPreviousItemPeek={48}>
      <MessageScroller className="flex-1">
        <MessageScrollerViewport className="px-3 py-4">
          <MessageScrollerContent
            className="mx-auto w-full max-w-2xl gap-4"
            aria-busy={conversation.status === "streaming"}>
            {conversation.messages.map((message) => (
              <MessageScrollerItem key={message.id} messageId={message.id} scrollAnchor={message.role === "user"}>
                <TranscriptMessage message={message} />
              </MessageScrollerItem>
            ))}
            {conversation.status === "streaming" && (
              <MessageScrollerItem
                messageId="streaming"
                className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                Agent is thinking…
              </MessageScrollerItem>
            )}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  );
}
