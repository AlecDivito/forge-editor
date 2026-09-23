import { ChangeEvent, DragEvent, FormEvent, useEffect, useRef, useState } from "react";
import { useAgentChat } from "./use-agent-chat.hook";
import { useCreateAgentSession } from "./use-create-agent-session.hook";
import { useAgentAttachments } from "./use-agent-attachments.hook";
import { useAgentHarnessStore } from "../store/agent-harness.store";
import { AgentModelSelection } from "../types/agent-harness.types";

export function useAgentComposer(conversationId: string | null, model: AgentModelSelection | null) {
  const { startChat, stopChat } = useAgentChat();
  const { createSession, isCreating } = useCreateAgentSession();
  const conversation = useAgentHarnessStore((state) => state.conversations.find((item) => item.id === conversationId));
  const queuedEdit = useAgentHarnessStore((state) => state.queuedEdit);
  const clearQueuedEdit = useAgentHarnessStore((state) => state.clearQueuedEdit);
  const [draft, setDraft] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const { attachments, attachmentError, clearSentAttachments, removeAttachment, uploadFiles } = useAgentAttachments(conversationId);
  const lastQueuedAt = useRef(0);
  useEffect(() => {
    if (!queuedEdit) return;
    setDraft(queuedEdit.content);
    clearQueuedEdit();
  }, [clearQueuedEdit, queuedEdit]);
  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    void uploadFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  };
  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setIsDragging(false);
    void uploadFiles(Array.from(event.dataTransfer.files));
  };
  const onPaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files);
    if (files.some((file) => file.type.startsWith("image/"))) {
      event.preventDefault();
      void uploadFiles(files);
    }
  };
  const send = () => {
    const text = draft.trim();
    if (!text || !model || isCreating) return false;
    if (attachments.some((attachment) => attachment.status !== "ready")) return false;
    const targetConversationId = conversation?.id ?? attachments[0]?.sessionId;
    const sendPrompt = (id: string) => startChat({ conversationId: id, prompt: text, attachments, model });
    const sent = targetConversationId ? sendPrompt(targetConversationId) : createSession(sendPrompt);
    if (!sent) return false;
    if (conversation?.status !== "idle") lastQueuedAt.current = Date.now();
    setDraft("");
    clearSentAttachments();
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
    attachmentError,
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
