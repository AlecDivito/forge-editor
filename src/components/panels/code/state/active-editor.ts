import type { EditorView } from "@codemirror/view";
import { getEditorInstance } from "./editor-instance.registry";
import { selectActivePanel, useEditorSessionStore } from "./editor-session.store";

export function getActiveEditor(): EditorView | undefined {
  const { activePanelId } = useEditorSessionStore.getState();
  return activePanelId ? getEditorInstance(activePanelId) : undefined;
}

export function getActiveDocument() {
  const panel = selectActivePanel(useEditorSessionStore.getState());
  if (!panel || panel.kind !== "code") return undefined;
  return { workspace: panel.workspace, fileId: panel.fileId };
}
