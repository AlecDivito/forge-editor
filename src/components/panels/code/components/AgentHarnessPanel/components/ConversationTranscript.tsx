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
import { Loader2, Wrench } from "lucide-react";
import { ToolActivityTimeline } from "./ToolActivityTimeline";
import { useAgentHarnessStore } from "../store/agent-harness.store";
import { AgentMessage } from "../types/agent-harness.types";

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
        <Bubble variant={user ? "default" : "ghost"}>
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
  const messages = conversation?.messages ?? [];
  const isStreaming = conversation?.status === "streaming";
  return (
    <MessageScrollerProvider autoScroll defaultScrollPosition="last-anchor" scrollPreviousItemPeek={48}>
      <MessageScroller className="flex-1">
        <MessageScrollerViewport className="px-3 py-4">
          <MessageScrollerContent className="mx-auto w-full max-w-2xl gap-4" aria-busy={isStreaming}>
            {messages.map((message) => (
              <MessageScrollerItem key={message.id} messageId={message.id} scrollAnchor={message.role === "user"}>
                {message.role === "assistant" ? (
                  <ToolActivityTimeline
                    activities={
                      conversation?.toolActivities.filter((activity) => activity.requestId === message.id) ?? []
                    }
                  />
                ) : null}
                <TranscriptMessage message={message} />
              </MessageScrollerItem>
            ))}
            {isStreaming && (
              <MessageScrollerItem messageId="streaming" className="px-1">
                <Marker aria-live="polite" className="text-xs">
                  <MarkerIcon>
                    <Loader2 className="size-3.5 animate-spin" />
                  </MarkerIcon>
                  <MarkerContent className="animate-pulse">Generating response…</MarkerContent>
                </Marker>
              </MessageScrollerItem>
            )}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  );
}
