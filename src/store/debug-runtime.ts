import { create } from "zustand";
import { socket } from "@/lib/ws/connection";
import type { WorkspaceId } from "@/lib/ws/messages";
import { useEditorSessionStore } from "@/components/panels/code/state/editor-session.store";

export type DebugThread = { threadHandle: string; name: string };
export type DebugFrame = {
  frameHandle: string;
  name: string;
  source: { kind: string; file_id?: string; source_handle?: string; name?: string };
  line: number;
  column?: number;
};
export type DebugScope = { name: string; variablesHandle: string; expensive: boolean };
export type DebugVariable = {
  name: string;
  value: string;
  type?: string;
  variablesHandle?: string;
  valueTruncated: boolean;
};
type Authority = { workspace: WorkspaceId; session: string; attachment: number; generation: number };
export type DebugWatch = {
  id: string;
  expression: string;
  autoRefresh: boolean;
  value?: string;
  error?: string;
  generation?: number;
};
type State = {
  authority?: Authority;
  threads: DebugThread[];
  frames: DebugFrame[];
  totalFrames?: number;
  stackTruncated: boolean;
  selectedFrameHandle?: string;
  scopes: DebugScope[];
  variables: Record<string, DebugVariable[]>;
  variableTruncated: Record<string, boolean>;
  watches: DebugWatch[];
  watchSession?: string;
  loading?: string;
  error?: string;
  reset(authority?: Authority): void;
  threadsLoad(): Promise<void>;
  stackLoad(thread: string, append?: boolean): Promise<void>;
  scopesLoad(frame: string): Promise<void>;
  variablesLoad(handle: string): Promise<void>;
  evaluate(expression: string, frame?: string): Promise<DebugVariable>;
  execute(operation: "continue" | "next" | "step_in" | "step_out", thread: string): Promise<void>;
  pause(workspace: WorkspaceId, session: string, attachment: number): Promise<void>;
  watchAdd(expression: string): Promise<void>;
  watchRemove(id: string): Promise<void>;
  watchAutoRefresh(id: string, autoRefresh: boolean): Promise<void>;
  watchRefresh(id: string): Promise<void>;
  sourceOpen(handle: string, name?: string): Promise<void>;
};
const request = <T>(a: Authority, operation: Parameters<typeof socket.debugRequest>[4]) =>
  socket.debugRequest<T>(a.workspace, a.session, a.attachment, a.generation, operation);
export const useDebugRuntimeStore = create<State>((set, get) => ({
  threads: [],
  frames: [],
  stackTruncated: false,
  scopes: [],
  variables: {},
  variableTruncated: {},
  watches: [],
  reset(authority) {
    const previous = get().authority;
    const watchSession = get().watchSession;
    if (
      previous &&
      (!authority || authority.session !== previous.session || authority.generation !== previous.generation)
    )
      useEditorSessionStore.getState().closeGeneratedSources(previous.session, previous.generation);
    set({
      authority,
      threads: [],
      frames: [],
      totalFrames: undefined,
      stackTruncated: false,
      selectedFrameHandle: undefined,
      scopes: [],
      variables: {},
      variableTruncated: {},
      watches:
        authority && watchSession && watchSession !== authority.session ? [] : get().watches,
      watchSession: authority?.session ?? watchSession,
      loading: undefined,
      error: undefined,
    });
  },
  async threadsLoad() {
    const a = get().authority;
    if (!a) return;
    set({ loading: "threads", error: undefined });
    try {
      const r = await request<{ threads: DebugThread[] }>(a, { operation: "threads" });
      if (get().authority === a) set({ threads: r.threads, loading: undefined });
    } catch (e) {
      set({ error: String(e), loading: undefined });
    }
  },
  async stackLoad(thread, append = false) {
    const a = get().authority;
    if (!a) return;
    const start = append ? get().frames.length : 0;
    set({ loading: "stack", frames: append ? get().frames : [], scopes: [], variables: {}, variableTruncated: {} });
    try {
      const r = await request<{ frames: DebugFrame[]; totalFrames?: number; truncated: boolean }>(a, {
        operation: "stack_trace",
        thread_handle: thread,
        start_frame: start,
        levels: 50,
      });
      if (get().authority === a)
        set((state) => ({
          frames: append ? [...state.frames, ...r.frames] : r.frames,
          totalFrames: r.totalFrames,
          stackTruncated: r.truncated,
          loading: undefined,
        }));
    } catch (e) {
      set({ error: String(e), loading: undefined });
    }
  },
  async scopesLoad(frame) {
    const a = get().authority;
    if (!a) return;
    set({ loading: "scopes", selectedFrameHandle: frame, scopes: [], variables: {}, variableTruncated: {} });
    try {
      const r = await request<{ scopes: DebugScope[] }>(a, { operation: "scopes", frame_handle: frame });
      if (get().authority === a) set({ scopes: r.scopes, loading: undefined });
    } catch (e) {
      set({ error: String(e), loading: undefined });
    }
  },
  async variablesLoad(handle) {
    const a = get().authority;
    if (!a) return;
    set({ loading: handle });
    try {
      const r = await request<{ variables: DebugVariable[]; truncated: boolean }>(a, { operation: "variables", variables_handle: handle });
      if (get().authority === a)
        set((s) => ({
          variables: { ...s.variables, [handle]: r.variables },
          variableTruncated: { ...s.variableTruncated, [handle]: r.truncated },
          loading: undefined,
        }));
    } catch (e) {
      set({ error: String(e), loading: undefined });
    }
  },
  async evaluate(expression, frame) {
    const a = get().authority;
    if (!a) throw new Error("debug_not_stopped");
    const r = await request<{ value: string; type?: string; variablesHandle?: string; valueTruncated: boolean }>(a, {
      operation: "evaluate",
      expression,
      frame_handle: frame,
      context: "repl",
    });
    return {
      name: expression,
      value: r.value,
      type: r.type,
      variablesHandle: r.variablesHandle,
      valueTruncated: r.valueTruncated,
    };
  },
  async execute(operation, thread) {
    const a = get().authority;
    if (!a) return;
    set({ threads: [], frames: [], scopes: [], variables: {}, variableTruncated: {} });
    await request(a, { operation, thread_handle: thread });
    set({ authority: undefined });
  },
  async pause(workspace, session, attachment) {
    await socket.debugRequest(workspace, session, attachment, undefined, { operation: "pause" });
  },
  async watchAdd(expression) {
    expression = expression.trim();
    if (!expression || get().watches.length >= 100) return;
    const a = get().authority;
    if (!a) return;
    const value = await request<{ watchId: string; expression: string; autoRefresh: boolean }>(a, {
      operation: "watch_create",
      expression,
      auto_refresh: false,
    });
    if (get().authority === a)
      set((s) => ({
        watches: [...s.watches, { id: value.watchId, expression: value.expression, autoRefresh: value.autoRefresh }],
      }));
  },
  async watchRemove(id) {
    const a = get().authority;
    if (!a) return;
    await request(a, { operation: "watch_delete", watch_id: id });
    if (get().authority === a) set((s) => ({ watches: s.watches.filter((w) => w.id !== id) }));
  },
  async watchAutoRefresh(id, autoRefresh) {
    const a = get().authority;
    if (!a) return;
    const result = await request<{ watchId: string; expression: string; autoRefresh: boolean }>(a, {
      operation: "watch_update",
      watch_id: id,
      auto_refresh: autoRefresh,
    });
    if (get().authority === a)
      set((state) => ({
        watches: state.watches.map((watch) =>
          watch.id === id ? { ...watch, expression: result.expression, autoRefresh: result.autoRefresh } : watch,
        ),
      }));
  },
  async watchRefresh(id) {
    const a = get().authority;
    const watch = get().watches.find((w) => w.id === id);
    if (!a || !watch) return;
    try {
      const response = await request<{ result: { value: string } }>(a, { operation: "watch_refresh", watch_id: id });
      const result = response.result;
      if (get().authority === a)
        set((s) => ({
          watches: s.watches.map((w) =>
            w.id === id ? { ...w, value: result.value, error: undefined, generation: a.generation } : w,
          ),
        }));
    } catch (error) {
      set((s) => ({
        watches: s.watches.map((w) => (w.id === id ? { ...w, error: String(error), generation: a.generation } : w)),
      }));
    }
  },
  async sourceOpen(handle, name) {
    const a = get().authority;
    if (!a) return;
    const result = await request<{ content: string; mimeType?: string }>(a, {
      operation: "source",
      source_handle: handle,
    });
    if (get().authority !== a) return;
    useEditorSessionStore.getState().openGeneratedSource({
      workspace: a.workspace,
      sessionId: a.session,
      generation: a.generation,
      sourceHandle: handle,
      name: name ?? "Generated source",
      content: result.content,
      mimeType: result.mimeType,
    });
  },
}));
