import type { EditorView } from "@codemirror/view";
import { getActiveDocument, getActiveEditor } from "@/components/panels/code/state/active-editor";
import { getEditorInstance, registerEditorInstance, waitForEditorInstance } from "@/components/panels/code/state/editor-instance.registry";
import { CodePanelDescriptor, useEditorSessionStore } from "@/components/panels/code/state/editor-session.store";
import { FileId, WorkspaceId } from "@/lib/ws/messages";

const panel: CodePanelDescriptor = {
  id: "panel-1",
  kind: "code",
  workspace: "workspace-1" as WorkspaceId,
  fileId: "/src/index.ts" as FileId,
};

afterEach(() => {
  useEditorSessionStore.setState({
    panelsById: {},
    panelOrder: [],
    activePanelId: null,
    pendingClosePanelId: null,
  });
});

describe("editor instance registry", () => {
  it("joins the active panel to its mounted editor and document", () => {
    const view = {} as EditorView;
    const unregister = registerEditorInstance(panel.id, view);
    useEditorSessionStore.setState({
      panelsById: { [panel.id]: panel },
      panelOrder: [panel.id],
      activePanelId: panel.id,
    });

    expect(getActiveEditor()).toBe(view);
    expect(getActiveDocument()).toEqual({ workspace: panel.workspace, fileId: panel.fileId });

    unregister();
    expect(getActiveEditor()).toBeUndefined();
  });

  it("does not let an old cleanup unregister a replacement view", () => {
    const oldView = {} as EditorView;
    const replacementView = {} as EditorView;
    const unregisterOld = registerEditorInstance(panel.id, oldView);
    const unregisterReplacement = registerEditorInstance(panel.id, replacementView);

    unregisterOld();
    expect(getEditorInstance(panel.id)).toBe(replacementView);

    unregisterReplacement();
    expect(getEditorInstance(panel.id)).toBeUndefined();
  });

  it("waits for the requested panel and supports cancellation", async () => {
    const view = {} as EditorView;
    const waiting = waitForEditorInstance(panel.id);
    registerEditorInstance(panel.id, view);
    await expect(waiting).resolves.toBe(view);

    const controller = new AbortController();
    const cancelled = waitForEditorInstance("missing", { signal: controller.signal });
    controller.abort();
    await expect(cancelled).rejects.toHaveProperty("name", "AbortError");
  });
});
