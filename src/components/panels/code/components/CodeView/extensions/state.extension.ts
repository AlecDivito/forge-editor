import { FileId, WorkspaceId } from "@/lib/ws/messages";
import { Facet } from "@uiw/react-codemirror";

// CodeMirror evaluates facet combiners with an empty input during facet
// definition, before an EditorState exists. Represent that framework-level
// empty state explicitly; actual editor consumers validate both values.
export const DocumentWorkspaceId = Facet.define<WorkspaceId, WorkspaceId | null>({
  combine: (values) => values[0] ?? null,
});
export const DocumentFileId = Facet.define<FileId, FileId | null>({
  combine: (values) => values[0] ?? null,
});
