import { ChangeEvent, DragEvent, FormEvent, useEffect, useRef, useState } from "react";
import { nanoid } from "nanoid";
import { useAgentChat } from "./use-agent-chat.hook";
import { useCreateAgentSession } from "./use-create-agent-session.hook";
import { useAgentHarnessStore } from "../store/agent-harness.store";
import { AgentAttachment, AgentModelSelection } from "../types/agent-harness.types";

const isImage = (file: File) => file.type.startsWith("image/");

export function useAgentComposer(conversationId: string | null, model: AgentModelSelection | null) {
  const { startChat, stopChat } = useAgentChat();
  const { createSession, isCreating } = useCreateAgentSession();
  const conversation = useAgentHarnessStore((state) => state.conversations.find((item) => item.id === conversationId));
  const queuedEdit = useAgentHarnessStore((state) => state.queuedEdit);
  const clearQueuedEdit = useAgentHarnessStore((state) => state.clearQueuedEdit);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<AgentAttachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const attachmentRef = useRef<AgentAttachment[]>([]);
  const lastQueuedAt = useRef(0);
  useEffect(() => {
    attachmentRef.current = attachments;
  }, [attachments]);
  useEffect(
    () => () => {
      attachmentRef.current.forEach((attachment) => URL.revokeObjectURL(attachment.previewUrl));
    },
    [],
  );
  useEffect(() => {
    if (!queuedEdit) return;
    setDraft(queuedEdit.content);
    clearQueuedEdit();
  }, [clearQueuedEdit, queuedEdit]);
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
  const send = () => {
    const text = draft.trim();
    if (!text || !model || isCreating) return false;
    const sendPrompt = (id: string) => startChat({ conversationId: id, prompt: text, attachments, model });
    const sent = conversation ? sendPrompt(conversation.id) : createSession(sendPrompt);
    if (!sent) return false;
    if (conversation?.status !== "idle") lastQueuedAt.current = Date.now();
    setDraft("");
    setAttachments([]);
    return true;
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    send();
  };
  const stop = () => {
    const requestId = conversation?.activeRequestId;
    return Boolean(conversation && requestId && stopChat(conversation.id, requestId));
  };
  const handleEnter = () => {
    const isDoubleEnter = conversation?.status !== "idle"
      && !draft.trim()
      && Date.now() - lastQueuedAt.current < 750;
    if (isDoubleEnter) return stop();
    return send();
  };
  return {
    attachments,
    draft,
    isDragging,
    isCreating,
    onDrop,
    onDragEnter: () => setIsDragging(true),
    onDragLeave: () => setIsDragging(false),
    onFileChange,
    onPaste,
    removeAttachment,
    send,
    handleEnter,
    setDraft,
    submit,
    stop,
  };
}
