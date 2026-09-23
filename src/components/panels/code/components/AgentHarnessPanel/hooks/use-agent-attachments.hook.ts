import { abandonAttachment, completeAttachment, prepareAttachment } from "@/lib/generated/sdk.gen";
import { nanoid } from "nanoid";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAgentSession } from "./use-agent-session.hook";
import { AgentAttachment } from "../types/agent-harness.types";

const MAX_ATTACHMENTS = 4;

function uploadFile(uploadUrl: string, file: File, onProgress: (progress: number) => void) {
  return new Promise<string | undefined>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", uploadUrl);
    request.setRequestHeader("Content-Type", file.type);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onerror = () => reject(new Error("The image upload failed."));
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        resolve(request.getResponseHeader("ETag")?.replaceAll('"', "") ?? undefined);
      } else {
        reject(new Error(`The image upload failed with HTTP ${request.status}.`));
      }
    };
    request.send(file);
  });
}

/**
 * Owns the complete browser attachment lifecycle: durable preparation, direct
 * object-store upload, durable completion, and terminal abandonment. It also
 * creates and hydrates a session on the first upload without naming it.
 */
export function useAgentAttachments(conversationId: string | null) {
  const { mutateAsync: loadSession } = useAgentSession();
  const [attachments, setAttachments] = useState<AgentAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const attachmentsRef = useRef<AgentAttachment[]>([]);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);
  useEffect(
    () => () => {
      attachmentsRef.current.forEach((attachment) => URL.revokeObjectURL(attachment.previewUrl));
    },
    [],
  );

  const uploadFiles = useCallback(async (files: File[]) => {
    const images = files
      .filter((file) => file.type.startsWith("image/"))
      .slice(0, Math.max(0, MAX_ATTACHMENTS - attachmentsRef.current.length));
    if (!images.length) return;

    setAttachmentError(null);
    const sessionId = conversationId ?? nanoid();
    // Multiple files may prepare concurrently. Assign the promise before
    // awaiting it so only the first successful preparation hydrates the new
    // session into local UI state.
    let hydration: Promise<unknown> | null = conversationId ? Promise.resolve() : null;
    await Promise.all(images.map(async (file) => {
      let attachment: AgentAttachment | undefined;
      try {
        const prepared = await prepareAttachment({
          path: { session_id: sessionId },
          body: { filename: file.name, media_type: file.type, byte_size: file.size },
          throwOnError: true,
        });
        if (!hydration) hydration = loadSession(sessionId);
        await hydration;
        const pendingAttachment: AgentAttachment = {
          id: prepared.data.attachment.attachment_id,
          sessionId,
          name: file.name,
          mimeType: file.type,
          previewUrl: URL.createObjectURL(file),
          status: "uploading",
          progress: 0,
        };
        attachment = pendingAttachment;
        setAttachments((current) => [...current, pendingAttachment]);
        const etag = await uploadFile(prepared.data.upload_url, file, (progress) => {
          setAttachments((current) => current.map((item) => item.id === pendingAttachment.id ? { ...item, progress } : item));
        });
        await completeAttachment({
          path: { session_id: sessionId, attachment_id: pendingAttachment.id },
          body: etag ? { etag } : {},
          throwOnError: true,
        });
        setAttachments((current) => current.map((item) => item.id === pendingAttachment.id ? { ...item, status: "ready", progress: 100 } : item));
      } catch (error) {
        const message = error instanceof Error ? error.message : "The image upload failed.";
        if (!attachment) {
          setAttachmentError(message);
          console.error("Could not prepare AI image attachment", error);
          return;
        }
        const failedAttachment = attachment;
        await abandonAttachment({ path: { session_id: sessionId, attachment_id: failedAttachment.id }, throwOnError: true }).catch(() => undefined);
        setAttachments((current) => current.map((item) => item.id === failedAttachment.id ? { ...item, status: "failed", error: message } : item));
      }
    }));
  }, [conversationId, loadSession]);

  const removeAttachment = useCallback(async (id: string) => {
    const attachment = attachmentsRef.current.find((item) => item.id === id);
    if (!attachment || attachment.status === "uploading") return;
    setAttachments((current) => current.filter((item) => item.id !== id));
    URL.revokeObjectURL(attachment.previewUrl);
    await abandonAttachment({
      path: { session_id: attachment.sessionId, attachment_id: attachment.id },
      throwOnError: true,
    }).catch(() => undefined);
  }, []);

  const clearSentAttachments = useCallback(() => {
    setAttachments((current) => {
      current.forEach((attachment) => URL.revokeObjectURL(attachment.previewUrl));
      return [];
    });
  }, []);

  return { attachments, attachmentError, uploadFiles, removeAttachment, clearSentAttachments };
}
