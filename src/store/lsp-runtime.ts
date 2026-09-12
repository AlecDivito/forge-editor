import { create } from "zustand";
import type { LanguageId, WorkspaceId } from "@/lib/ws/messages";

export interface LspOutput { at: number; workspaceId: WorkspaceId; languageId: LanguageId; method: string; params: unknown }
export interface LspNotice extends LspOutput { message: string; severity: number }
export interface LspProgress extends LspOutput { token: string | number }

interface LspRuntimeState {
  notices: LspNotice[];
  output: LspOutput[];
  progress: Record<string, LspProgress>;
  route: (event: Omit<LspOutput, "at">) => void;
  notify: (message: string, severity?: number) => void;
  clearOutput: () => void;
}

const keyFor = (workspace: WorkspaceId, language: LanguageId, token: unknown) => `${workspace}\0${language}\0${String(token)}`;

export const useLspRuntimeStore = create<LspRuntimeState>((set) => ({
  notices: [], output: [], progress: {},
  notify: (message, severity = 1) => set((state) => ({ notices: [...state.notices, {
    at: Date.now(), workspaceId: "application" as WorkspaceId, languageId: "application" as LanguageId,
    method: "forge/message", params: { message }, message, severity,
  }].slice(-200) })),
  route: (event) => set((state) => {
    const item = { ...event, at: Date.now() };
    if (event.method === "window/showMessage") {
      const params = event.params as { type?: number; message?: string };
      return { notices: [...state.notices, { ...item, message: params.message ?? "Language server message", severity: params.type ?? 3 }].slice(-200) };
    }
    if (event.method === "$/progress") {
      const params = event.params as { token?: string | number; value?: { kind?: string } };
      if (params.token === undefined) return state;
      const key = keyFor(event.workspaceId, event.languageId, params.token);
      const progress = { ...state.progress };
      if (params.value?.kind === "end") delete progress[key];
      else progress[key] = { ...item, token: params.token };
      return { progress };
    }
    if (event.method === "forge/serverExited") {
      return { progress: Object.fromEntries(Object.entries(state.progress).filter(([, value]) => value.workspaceId !== event.workspaceId || value.languageId !== event.languageId)) };
    }
    return { output: [...state.output, item].slice(-1000) };
  }),
  clearOutput: () => set({ output: [] }),
}));
