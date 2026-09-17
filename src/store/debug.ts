import { create } from "zustand";
import type { FileId, WorkspaceId } from "@/lib/ws/messages";
import { apiUrl } from "@/lib/transport";

export interface RequestedBreakpoint {
  breakpointId: string;
  workspaceId: string;
  fileId: string;
  line: number;
  column?: number | null;
  enabled: boolean;
  condition?: string | null;
  hitCondition?: string | null;
  logMessage?: string | null;
  revision: number;
}
export interface VerifiedBreakpoint {
  requestedBreakpointId: string;
  adapterBreakpointId?: number | null;
  verified: boolean;
  resolvedLine?: number | null;
  resolvedColumn?: number | null;
  message?: string | null;
  sessionId: string;
}
type State = {
  byWorkspace: Record<string, RequestedBreakpoint[]>;
  loading: Record<string, boolean>;
  verificationBySession: Record<string, VerifiedBreakpoint[]>;
  setSessionVerification(session: string, verification: VerifiedBreakpoint[]): void;
  replace(workspace: WorkspaceId, breakpoints: RequestedBreakpoint[]): void;
  load(workspace: WorkspaceId): Promise<void>;
  toggle(workspace: WorkspaceId, file: FileId, line: number): Promise<void>;
  remove(workspace: WorkspaceId, breakpoint: RequestedBreakpoint): Promise<void>;
  update(
    workspace: WorkspaceId,
    breakpoint: RequestedBreakpoint,
    patch: {
      line?: number;
      column?: number | null;
      enabled?: boolean;
      condition?: string | null;
      hitCondition?: string | null;
      logMessage?: string | null;
    },
  ): Promise<void>;
};
const endpoint = (workspace: string) =>
  apiUrl(`/api/workspaces/${encodeURIComponent(workspace)}/debug/breakpoints`);
async function checked(response: Response) {
  if (!response.ok)
    throw new Error((await response.json().catch(() => null))?.message ?? `Debug request failed (${response.status})`);
  return response.status === 204 ? undefined : response.json();
}
export const useDebugIntentStore = create<State>((set, get) => ({
  byWorkspace: {},
  loading: {},
  verificationBySession: {},
  setSessionVerification(session, verification) {
    set((state) => ({ verificationBySession: { ...state.verificationBySession, [session]: verification } }));
  },
  replace(workspace, breakpoints) {
    set((state) => ({ byWorkspace: { ...state.byWorkspace, [workspace]: breakpoints } }));
  },
  async load(workspace) {
    set((s) => ({ loading: { ...s.loading, [workspace]: true } }));
    try {
      const value = await checked(await fetch(endpoint(workspace)));
      set((s) => ({ byWorkspace: { ...s.byWorkspace, [workspace]: value.breakpoints } }));
    } finally {
      set((s) => ({ loading: { ...s.loading, [workspace]: false } }));
    }
  },
  async toggle(workspace, file, line) {
    const existing = (get().byWorkspace[workspace] ?? []).find((b) => b.fileId === file && b.line === line);
    if (existing) return get().remove(workspace, existing);
    const created = await checked(
      await fetch(endpoint(workspace), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fileId: file, line, enabled: true }),
      }),
    );
    set((s) => ({ byWorkspace: { ...s.byWorkspace, [workspace]: [...(s.byWorkspace[workspace] ?? []), created] } }));
  },
  async remove(workspace, b) {
    await checked(
      await fetch(`${endpoint(workspace)}/${b.breakpointId}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedRevision: b.revision }),
      }),
    );
    set((s) => ({
      byWorkspace: {
        ...s.byWorkspace,
        [workspace]: (s.byWorkspace[workspace] ?? []).filter((x) => x.breakpointId !== b.breakpointId),
      },
    }));
  },
  async update(workspace, b, patch) {
    const updated = await checked(
      await fetch(`${endpoint(workspace)}/${b.breakpointId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedRevision: b.revision, ...patch }),
      }),
    );
    set((s) => ({
      byWorkspace: {
        ...s.byWorkspace,
        [workspace]: (s.byWorkspace[workspace] ?? []).map((x) => (x.breakpointId === b.breakpointId ? updated : x)),
      },
    }));
  },
}));
