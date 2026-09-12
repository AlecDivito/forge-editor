import { acquireDocument, DocEntry, releaseDocumentEntry } from "@/lib/documents/registry";
import { FileId, WorkspaceId } from "@/lib/ws/messages";
import { useEffect, useState } from "react";


export default function useDocument(workspaceId: WorkspaceId, fileId: FileId) {
    const [entry, setEntry] = useState<DocEntry | undefined>()

    useEffect(() => {
        const e = acquireDocument(workspaceId, fileId)
        setEntry(e)
        return () => releaseDocumentEntry(e)
    }, [workspaceId, fileId])

    return entry
}
