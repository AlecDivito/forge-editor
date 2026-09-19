import { ChangeEvent, DragEvent, FormEvent, useEffect, useRef, useState } from "react";
import { nanoid } from "nanoid";
import { useAgentHarnessStore } from "../store/agent-harness.store";
import { AgentAttachment, AgentProcessingRequest } from "../types/agent-harness.types";

const isImage = (file: File) => file.type.startsWith("image/");

export function useAgentComposer(conversationId: string) {
  const addMessage = useAgentHarnessStore((state) => state.addMessage);
  const conversation = useAgentHarnessStore((state) => state.conversations.find((item) => item.id === conversationId));
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<AgentAttachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const attachmentRef = useRef<AgentAttachment[]>([]);
  useEffect(() => {
    attachmentRef.current = attachments;
  }, [attachments]);
  useEffect(
    () => () => {
      attachmentRef.current.forEach((attachment) => URL.revokeObjectURL(attachment.previewUrl));
    },
    [],
  );
  const addFiles = (files: File[]) => {
    const images = files.filter(isImage).slice(0, Math.max(0, 4 - attachments.length));
    if (images.length)
      setAttachments((current) => [
        ...current,
        ...images.map((file) => ({
          id: nanoid(),
          name: file.name,
          mimeType: file.type,
          previewUrl: URL.createObjectURL(file),
        })),
      ]);
  };
  const removeAttachment = (id: string) =>
    setAttachments((current) => {
      const attachment = current.find((item) => item.id === id);
      if (attachment) URL.revokeObjectURL(attachment.previewUrl);
      return current.filter((item) => item.id !== id);
    });
  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    addFiles(Array.from(event.dataTransfer.files));
  };
  const onPaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files);
    if (files.some(isImage)) {
      event.preventDefault();
      addFiles(files);
    }
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = draft.trim();
    if ((!text && !attachments.length) || !conversation?.model) return;
    const request: AgentProcessingRequest = {
      conversationId,
      prompt: text,
      model: {
        id: conversation.model.id,
        provider: conversation.model.provider,
      },
      attachments,
    };
    addMessage(conversationId, { id: nanoid(), role: "user", text, attachments });
    setDraft("");
    setAttachments([]);
    /* TODO(agent-ws): send `request` as AgentPrompt to AgentSessionActor. The
     * provider and model ID above are the canonical backend identifiers; labels
     * remain UI-only. Event handlers will set streaming status and append events. */
    void request;
  };
  return {
    attachments,
    draft,
    isDragging,
    onDrop,
    onDragEnter: () => setIsDragging(true),
    onDragLeave: () => setIsDragging(false),
    onFileChange,
    onPaste,
    removeAttachment,
    setDraft,
    submit,
  };
}
