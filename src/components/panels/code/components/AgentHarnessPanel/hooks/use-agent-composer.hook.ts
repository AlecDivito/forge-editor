import { ChangeEvent, DragEvent, FormEvent, useEffect, useRef, useState } from "react";
import { nanoid } from "nanoid";
import { useAgentHarnessStore } from "../store/agent-harness.store";
import { AgentAttachment } from "../types/agent-harness.types";

const isImage = (file: File) => file.type.startsWith("image/");

export function useAgentComposer(conversationId: string) {
  const addMessage = useAgentHarnessStore((state) => state.addMessage);
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
    if (!text && !attachments.length) return;
    addMessage(conversationId, { id: nanoid(), role: "user", text, attachments });
    setDraft("");
    setAttachments(
      [],
    ); /* TODO(agent-ws): send prompt and uploaded attachment IDs to AgentSessionActor; event handlers set streaming status and append normalized events. */
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
