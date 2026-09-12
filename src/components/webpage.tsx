"use client";

import { useEffect } from "react";
import VSCodeLayout from "./VsCodeLayout";
import { useDiagnosticsStore } from "./panels/code/state/diagnostics.store";
import { useEditorSessionStore } from "./panels/code/state/editor-session.store";
import { socket } from "@/lib/ws/connection";
import { subscribeFilesystemEvents } from "@/lib/documents/registry";
import { FileId } from "@/lib/ws/messages";
import { useQueryClient } from "@tanstack/react-query";
// import 'dockview-react/dist/styles/dockview.css';

interface Props {
}

export default function WebPageInitializer({ }: Props) {
  const publishDiagnostics = useDiagnosticsStore((s) => s.publish)
  const remapDiagnostics = useDiagnosticsStore((s) => s.remapPath)
  const removeDiagnostics = useDiagnosticsStore((s) => s.removePath)
  const remapPanels = useEditorSessionStore((s) => s.remapPath)
  const queryClient = useQueryClient()

  useEffect(() => {
    const unsubscribe = socket.subscribe(msg => {
      if (msg.kind === "Diagnostics") {
        publishDiagnostics(msg.workspace_id, msg.file_id, msg.diagnostics)
      }
    })
    const unsubscribeFilesystem = subscribeFilesystemEvents((event) => {
      if (event.kind === "FsRenamed") {
        remapPanels(event.workspace_id, event.from as FileId, event.to as FileId, event.entry_type)
        remapDiagnostics(event.workspace_id, event.from as FileId, event.to as FileId, event.entry_type)
      } else if (event.kind === "FsDeleted") {
        removeDiagnostics(event.workspace_id, event.path as FileId, event.entry_type)
      }
      // The websocket event is the cross-client source of truth. Invalidate
      // every directory listing because a directory move/delete changes both
      // the old and new parent, including listings not currently mounted.
      void queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey[0] as { _id?: string, query?: { workspace_id?: string } } | undefined
          return key?._id === "listFiles" && key.query?.workspace_id === event.workspace_id
        },
      })
    })
    return () => { unsubscribe(); unsubscribeFilesystem(); }
  }, [publishDiagnostics, queryClient, remapDiagnostics, remapPanels, removeDiagnostics]);

  return (
    <VSCodeLayout />
  );
}
