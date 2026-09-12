import { FileId, FsEntryType, WorkspaceId } from "@/lib/ws/messages";
import { documentKey, useDiagnosticsStore } from "@/components/panels/code/state/diagnostics.store";
import { CodePanelDescriptor, selectActivePanel, useEditorSessionStore } from "@/components/panels/code/state/editor-session.store";

const workspace = "workspace-1" as WorkspaceId;
const oldFile = "/src/index.ts" as FileId;
const newFile = "/app/index.ts" as FileId;
const panel: CodePanelDescriptor = { id: "panel-1", kind: "code", workspace, fileId: oldFile };

beforeEach(() => {
  useEditorSessionStore.setState({
    panelsById: { [panel.id]: panel },
    panelOrder: [panel.id],
    activePanelId: panel.id,
    pendingClosePanelId: null,
  });
  useDiagnosticsStore.setState({ byDocument: {}, staleKeys: {} });
});

describe("normalized editor state", () => {
  it("keeps the selected panel identity while remapping its document path", () => {
    useEditorSessionStore.getState().remapPath(
      workspace,
      "/src" as FileId,
      "/app" as FileId,
      FsEntryType.Directory,
    );

    expect(selectActivePanel(useEditorSessionStore.getState())).toEqual({ ...panel, fileId: newFile });
  });

  it("remaps diagnostics and rejects late publications for the old path", () => {
    const diagnostics = [];
    useDiagnosticsStore.getState().publish(workspace, oldFile, diagnostics);
    useDiagnosticsStore.getState().remapPath(workspace, oldFile, newFile, FsEntryType.File);
    useDiagnosticsStore.getState().publish(workspace, oldFile, []);

    const state = useDiagnosticsStore.getState();
    expect(state.byDocument[documentKey(workspace, oldFile)]).toBeUndefined();
    expect(state.byDocument[documentKey(workspace, newFile)]).toBe(diagnostics);
  });
});
