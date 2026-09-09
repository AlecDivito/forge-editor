import { FileId, WorkspaceId } from "@/lib/ws/messages";
import { Facet } from "@uiw/react-codemirror";

export const DocumentWorkspaceId = Facet.define<WorkspaceId, WorkspaceId>({ combine: (c) => c[0] || "" as WorkspaceId });
export const DocumentFileId = Facet.define<FileId, FileId>({ combine: (c) => c[0] || "" as FileId });