import * as Y from "yjs";
import { Awareness, encodeAwarenessUpdate } from "y-protocols/awareness";
import { socket } from "@/lib/ws/connection";
import {
  applyRemoteAwareness,
  installAwarenessTransport,
  setAwarenessVisible,
} from "@/lib/documents/awareness";
import type { FileId, WorkspaceId } from "@/lib/ws/messages";

describe("document awareness", () => {
  afterEach(() => jest.restoreAllMocks());

  it("advertises only while visible and publishes a removal when hidden", () => {
    const send = jest.spyOn(socket, "send").mockReturnValue(true);
    const local = new Awareness(new Y.Doc());
    const remote = new Awareness(new Y.Doc());
    remote.setLocalState(null);
    const dispose = installAwarenessTransport(local, () => ({
      workspaceId: "workspace" as WorkspaceId,
      fileId: "src/file.ts" as FileId,
    }));

    setAwarenessVisible(local, true);
    expect(send).toHaveBeenCalledTimes(1);
    const joined = send.mock.calls[0][0];
    expect(joined.kind).toBe("AwarenessUpdate");
    if (joined.kind !== "AwarenessUpdate") throw new Error("unexpected message");
    applyRemoteAwareness(remote, joined.payload);
    expect(remote.getStates().get(local.clientID)?.user?.name).toMatch(/^Guest |Anonymous$/);

    setAwarenessVisible(local, false);
    expect(send).toHaveBeenCalledTimes(2);
    const left = send.mock.calls[1][0];
    if (left.kind !== "AwarenessUpdate") throw new Error("unexpected message");
    applyRemoteAwareness(remote, left.payload);
    expect(remote.getStates().has(local.clientID)).toBe(false);

    dispose();
    local.destroy();
    remote.destroy();
  });

  it("does not echo remotely applied updates", () => {
    const send = jest.spyOn(socket, "send").mockReturnValue(true);
    const source = new Awareness(new Y.Doc());
    const target = new Awareness(new Y.Doc());
    const dispose = installAwarenessTransport(target, () => ({
      workspaceId: "workspace" as WorkspaceId,
      fileId: "src/file.ts" as FileId,
    }));
    source.setLocalState({ user: { name: "Peer" } });
    applyRemoteAwareness(target, Array.from(encodeAwarenessUpdate(source, [source.clientID])));
    expect(send).not.toHaveBeenCalled();

    dispose();
    source.destroy();
    target.destroy();
  });
});
