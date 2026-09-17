import { act } from "@testing-library/react";
import { socket } from "@/lib/ws/connection";
import type { WorkspaceId } from "@/lib/ws/messages";
import { useDebugRuntimeStore } from "@/store/debug-runtime";

describe("debug runtime generations", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    useDebugRuntimeStore.setState({
      authority: undefined,
      threads: [],
      frames: [],
      scopes: [],
      variables: {},
      watches: [],
      loading: undefined,
      error: undefined,
    });
  });
  it("discards a delayed thread result after a newer stop", async () => {
    let resolve!: (value: unknown) => void;
    jest.spyOn(socket, "debugRequest").mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }) as never,
    );
    const old = { workspace: "workspace" as WorkspaceId, session: "session", attachment: 1, generation: 1 };
    useDebugRuntimeStore.getState().reset(old);
    const pending = useDebugRuntimeStore.getState().threadsLoad();
    useDebugRuntimeStore.getState().reset({ ...old, generation: 2 });
    resolve({ threads: [{ threadHandle: "stale", name: "stale" }] });
    await act(async () => pending);
    expect(useDebugRuntimeStore.getState().threads).toEqual([]);
    expect(useDebugRuntimeStore.getState().authority?.generation).toBe(2);
  });
  it("invalidates inspection state before awaiting continue", async () => {
    let resolve!: () => void;
    jest.spyOn(socket, "debugRequest").mockReturnValue(
      new Promise<void>((r) => {
        resolve = r;
      }) as never,
    );
    const authority = { workspace: "workspace" as WorkspaceId, session: "session", attachment: 1, generation: 1 };
    useDebugRuntimeStore.setState({
      authority,
      threads: [{ threadHandle: "thread", name: "main" }],
      frames: [{ frameHandle: "frame", name: "main", source: { kind: "unavailable" }, line: 0 }],
      scopes: [{ name: "Locals", variablesHandle: "vars", expensive: false }],
      variables: { vars: [] },
    });
    const pending = useDebugRuntimeStore.getState().execute("continue", "thread");
    expect(useDebugRuntimeStore.getState().frames).toEqual([]);
    expect(useDebugRuntimeStore.getState().variables).toEqual({});
    resolve();
    await pending;
  });
});
