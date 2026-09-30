import { getBreakpoints, useBreakpointStore } from "@/components/panels/code/state/breakpoints.store";
import { FileId, FsEntryType, WorkspaceId } from "@/lib/ws/messages";

const workspace = "workspace-1" as WorkspaceId;
const file = "/src/index.ts" as FileId;

beforeEach(() => {
  useBreakpointStore.setState({ byDocument: {} });
});

describe("breakpoint store", () => {
  it("toggles normalized, document-scoped breakpoint lines", () => {
    const store = useBreakpointStore.getState();

    store.toggle(workspace, file, 12);
    store.toggle(workspace, file, 3);
    store.toggle(workspace, file, 12);

    expect(getBreakpoints(workspace, file)).toEqual([{ line: 3 }]);
  });

  it("keeps breakpoints attached when a file moves", () => {
    const nextFile = "/app/index.ts" as FileId;
    const store = useBreakpointStore.getState();
    store.set(workspace, file, [{ line: 4 }]);

    store.remapPath(workspace, "/src" as FileId, "/app" as FileId, FsEntryType.Directory);

    expect(getBreakpoints(workspace, file)).toEqual([]);
    expect(getBreakpoints(workspace, nextFile)).toEqual([{ line: 4 }]);
  });

  it("removes breakpoints when their file is deleted", () => {
    const store = useBreakpointStore.getState();
    store.set(workspace, file, [{ line: 4 }]);

    store.removePath(workspace, file, FsEntryType.File);

    expect(getBreakpoints(workspace, file)).toEqual([]);
  });
});
