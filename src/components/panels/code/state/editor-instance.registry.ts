import type { EditorView } from "@codemirror/view";

const editorInstances = new Map<string, EditorView>();

export function registerEditorInstance(panelId: string, view: EditorView): () => void {
  editorInstances.set(panelId, view);
  return () => {
    if (editorInstances.get(panelId) === view) editorInstances.delete(panelId);
  };
}

export function getEditorInstance(panelId: string): EditorView | undefined {
  return editorInstances.get(panelId);
}

