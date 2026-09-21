import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ImagePlus, SendHorizonal, Square, X } from "lucide-react";
import { useRef, useState } from "react";
import { useAgentComposer } from "../hooks/use-agent-composer.hook";
import { useAgentHarnessStore } from "../store/agent-harness.store";
import { AgentModelSelection } from "../types/agent-harness.types";
import { ModelSelector } from "./ModelSelector";

export function AgentComposer() {
  const activeConversationId = useAgentHarnessStore((state) => state.activeConversationId);
  const conversation = useAgentHarnessStore((state) =>
    state.conversations.find((item) => item.id === activeConversationId),
  );
  const setModel = useAgentHarnessStore((state) => state.setModel);
  const fileInput = useRef<HTMLInputElement>(null);
  const [pendingModel, setPendingModel] = useState<AgentModelSelection | null>(null);
  const selectedModel = conversation?.model ?? pendingModel;
  const composer = useAgentComposer(activeConversationId, selectedModel);
  const canSend =
    Boolean(composer.draft.trim()) &&
    Boolean(selectedModel) &&
    !composer.isCreating;

  return (
    <form onSubmit={composer.submit} className="shrink-0 border-t border-border bg-card p-3">
      <div
        className={`relative rounded-xl border bg-background p-2 shadow-sm transition-colors ${composer.isDragging ? "border-primary ring-2 ring-primary/20" : "border-input focus-within:ring-1 focus-within:ring-ring"}`}
        onDrop={composer.onDrop}
        onDragEnter={composer.onDragEnter}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={composer.onDragLeave}>
        {composer.isDragging && (
          <div className="pointer-events-none absolute inset-1 z-10 grid place-items-center rounded-lg border border-dashed border-primary bg-primary/10 text-sm font-medium text-primary">
            Drop image to attach
          </div>
        )}
        {composer.attachments.length > 0 && (
          <div className="flex gap-2 overflow-x-auto px-1 pb-2">
            {composer.attachments.map((attachment) => (
              <div key={attachment.id} className="relative size-14 shrink-0">
                <img
                  src={attachment.previewUrl}
                  alt={attachment.name}
                  className="size-full rounded-md border border-border object-cover"
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  className="absolute -right-1.5 -top-1.5 size-5 rounded-full"
                  onClick={() => composer.removeAttachment(attachment.id)}>
                  <X className="size-3" />
                  <span className="sr-only">Remove {attachment.name}</span>
                </Button>
              </div>
            ))}
          </div>
        )}
        <Textarea
          value={composer.draft}
          onChange={(event) => composer.setDraft(event.target.value)}
          onPaste={composer.onPaste}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              composer.send();
            }
          }}
          placeholder="Ask about your workspace"
          rows={3}
          disabled={composer.isCreating}
          className="min-h-0 resize-none border-0 bg-transparent px-1 py-1 shadow-none focus-visible:ring-0"
          aria-label="Agent prompt"
        />
        <div className="flex items-center justify-between gap-2 pt-1">
          <div className="flex min-w-0 items-center gap-1">
            <ModelSelector
              model={selectedModel}
              onModelChange={(model) => {
                if (conversation) setModel(conversation.id, model);
                else setPendingModel(model);
              }}
            />
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              onChange={composer.onFileChange}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground"
              onClick={() => fileInput.current?.click()}
              title="Attach image">
              <ImagePlus className="size-3.5" />
              <span className="sr-only">Attach image</span>
            </Button>
          </div>
          {conversation?.status === "streaming" ? (
            <Button type="button" size="icon" variant="secondary" className="size-7" onClick={composer.stop} title="Stop agent">
              <Square className="size-3.5 fill-current" />
              <span className="sr-only">Stop agent</span>
            </Button>
          ) : (
            <Button type="submit" size="icon" className="size-7" disabled={!canSend} title="Send prompt">
              <SendHorizonal className="size-3.5" />
              <span className="sr-only">Send prompt</span>
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}
