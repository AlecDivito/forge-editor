import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { Position, Range } from "vscode-languageserver-protocol";
import type { FileId, WorkspaceId } from "@/lib/ws/messages";
import { useEditorSessionStore } from "./editor-session.store";
import { waitForEditorInstance } from "./editor-instance.registry";

export interface EditorLocation {
  workspaceId: WorkspaceId;
  fileId: FileId;
  range?: Range;
  position?: Position;
}

export function utf16PositionToOffset(view: EditorView, position: Position): number {
  const lineNumber = Math.min(Math.max(position.line + 1, 1), view.state.doc.lines);
  const line = view.state.doc.line(lineNumber);
  let units = 0;
  let offset = line.from;
  for (const char of line.text) {
    const width = char.length;
    if (units + width > Math.max(position.character, 0)) break;
    units += width;
    offset += char.length;
  }
  return Math.min(offset, line.to);
}

export async function openEditorLocation(location: EditorLocation, signal?: AbortSignal): Promise<void> {
  const store = useEditorSessionStore.getState();
  const panelId = store.openFile(location.workspaceId, location.fileId);
  store.setActivePanel(panelId);
  const view = await waitForEditorInstance(panelId, { signal });
  const panel = useEditorSessionStore.getState().panelsById[panelId];
  if (!panel || panel.kind !== "code" || panel.workspace !== location.workspaceId || panel.fileId !== location.fileId) {
    throw new Error("The target editor changed while navigation was in progress");
  }
  const start = utf16PositionToOffset(view, location.range?.start ?? location.position ?? { line: 0, character: 0 });
  const end = location.range ? utf16PositionToOffset(view, location.range.end) : start;
  view.dispatch({
    selection: EditorSelection.single(start, Math.max(start, end)),
    effects: EditorView.scrollIntoView(start, { y: "center" }),
  });
  view.focus();
}
