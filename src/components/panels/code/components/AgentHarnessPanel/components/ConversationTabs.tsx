import { Button } from "@/components/ui/button";
import { Clock3, Plus, X } from "lucide-react";
import { useState } from "react";
import { useAgentHarnessStore } from "../store/agent-harness.store";
import { useCreateAgentSession } from "../hooks/use-create-agent-session.hook";
import { useAgentSession } from "../hooks/use-agent-session.hook";
import { useAgentSessions } from "../hooks/use-agent-sessions.hook";

export function ConversationTabs() {
  const activeConversationId = useAgentHarnessStore((state) => state.activeConversationId);
  const conversations = useAgentHarnessStore((state) => state.conversations);
  const onSelect = useAgentHarnessStore((state) => state.selectConversation);
  const onClose = useAgentHarnessStore((state) => state.closeConversation);
  const { groups } = useAgentSessions();
  const loadSession = useAgentSession();
  const { createSession, isCreating } = useCreateAgentSession();
  const loadingSessionId = loadSession.isPending ? loadSession.variables : null;
  const [historyOpen, setHistoryOpen] = useState(false);
  const openConversations = conversations.filter((conversation) => conversation.isOpen);
  return (
    <div className="flex min-w-0 items-center border-b border-border bg-card px-2">
      <div
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-1.5"
        role="tablist"
        aria-label="Agent conversations">
        {openConversations.map((conversation) => (
          <div
            key={conversation.id}
            className={`flex max-w-44 shrink-0 items-center rounded-md pr-1 text-xs transition-colors ${conversation.id === activeConversationId ? "bg-background font-medium text-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>
            <button
              type="button"
              role="tab"
              aria-selected={conversation.id === activeConversationId}
              onClick={() => onSelect(conversation.id)}
              className="min-w-0 truncate px-2.5 py-1.5 text-left">
              {conversation.title}
            </button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-5 shrink-0 rounded-sm"
              onClick={() => onClose(conversation.id)}
              title={`Close ${conversation.title}`}>
              <X className="size-3" />
              <span className="sr-only">Close {conversation.title}</span>
            </Button>
          </div>
        ))}
      </div>
      <div className="relative shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={() => setHistoryOpen((open) => !open)}
          title="Conversation history"
          aria-expanded={historyOpen}>
          <Clock3 className="size-4" />
          <span className="sr-only">Conversation history</span>
        </Button>
        {historyOpen && (
          <div className="absolute right-0 top-9 z-20 w-64 rounded-lg border border-border bg-popover p-1 shadow-lg">
            {groups.map(({ label, conversations: groupedConversations }) => (
              <div key={label} className="py-1">
                <p className="px-2 py-1 text-[11px] font-medium text-muted-foreground">{label}</p>
                {groupedConversations.map((conversation) => (
                  <button
                    key={conversation.id}
                    type="button"
                    onClick={() => {
                      const isLoaded = conversations.some((item) => item.id === conversation.id && item.isOpen);
                      if (isLoaded) {
                        onSelect(conversation.id);
                        setHistoryOpen(false);
                      } else {
                        loadSession.mutate(conversation.id, {
                          onSuccess: () => setHistoryOpen(false),
                        });
                      }
                    }}
                    disabled={loadingSessionId === conversation.id}
                    className={`flex w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted ${conversation.id === activeConversationId ? "bg-muted font-medium text-foreground" : "text-foreground"}`}>
                    <span className="truncate">{loadingSessionId === conversation.id ? "Loading…" : conversation.title}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="size-7 shrink-0"
        onClick={() => createSession()}
        disabled={isCreating}
        title="New conversation">
        <Plus className="size-4" />
        <span className="sr-only">New conversation</span>
      </Button>
    </div>
  );
}
