"use client";

import { createContext, createElement, ReactNode, useContext, useEffect, useState } from "react";
import { createStore, StoreApi, useStore } from "zustand";
import { WorkspaceId } from "@/lib/ws/messages";
import { fetchEnvironmentSnapshot } from "./api";
import { EnvironmentSnapshot } from "./model";

export type WorkspaceState = {
  status: "idle" | "loading" | "ready" | "error";
  snapshot?: EnvironmentSnapshot;
  selectedWorkspaceId?: WorkspaceId;
  error?: string;
  initialize: (snapshot: EnvironmentSnapshot) => void;
  refresh: () => Promise<void>;
  selectWorkspace: (id: WorkspaceId) => void;
  restoreSelection: () => void;
};

const STORAGE_KEY = "forge.selectedWorkspace";
const WorkspaceStoreContext = createContext<StoreApi<WorkspaceState> | null>(null);

function selectedId(snapshot: EnvironmentSnapshot): WorkspaceId {
  const persisted = typeof window === "undefined" ? null : localStorage.getItem(STORAGE_KEY);
  return snapshot.workspaces.some(({ id }) => id === persisted) ? persisted as WorkspaceId : snapshot.default_workspace_id;
}

function createWorkspaceStore(initial?: EnvironmentSnapshot) {
  return createStore<WorkspaceState>((set, get) => ({
    status: initial ? "ready" : "idle",
    snapshot: initial,
    selectedWorkspaceId: initial?.default_workspace_id,
    initialize: (snapshot) => set({ status: "ready", snapshot, selectedWorkspaceId: selectedId(snapshot), error: undefined }),
    refresh: async () => {
      set({ status: "loading", error: undefined });
      try {
        const snapshot = await fetchEnvironmentSnapshot();
        set({ status: "ready", snapshot, selectedWorkspaceId: selectedId(snapshot) });
      } catch (error) {
        set({ status: "error", error: error instanceof Error ? error.message : "Unable to load environment" });
      }
    },
    selectWorkspace: (id) => {
      if (!get().snapshot?.workspaces.some((workspace) => workspace.id === id)) throw new Error(`Unknown workspace: ${id}`);
      localStorage.setItem(STORAGE_KEY, id);
      set({ selectedWorkspaceId: id });
    },
    restoreSelection: () => {
      const snapshot = get().snapshot;
      if (snapshot) set({ selectedWorkspaceId: selectedId(snapshot) });
    },
  }));
}

export function WorkspaceProvider({ initialEnvironment, children }: { initialEnvironment?: EnvironmentSnapshot; children: ReactNode }) {
  const [store] = useState(() => createWorkspaceStore(initialEnvironment));
  useEffect(() => {
    if (initialEnvironment) store.getState().restoreSelection();
    else void store.getState().refresh();
  }, [initialEnvironment, store]);
  return createElement(WorkspaceStoreContext.Provider, { value: store }, children);
}

export function useWorkspaceStore<T>(selector: (state: WorkspaceState) => T): T {
  const store = useContext(WorkspaceStoreContext);
  if (!store) throw new Error("useWorkspaceStore must be used within WorkspaceProvider");
  return useStore(store, selector);
}

export const selectedWorkspace = (state: WorkspaceState) => state.snapshot?.workspaces.find(({ id }) => id === state.selectedWorkspaceId);
