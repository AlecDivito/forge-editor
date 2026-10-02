"use client";

import type { SerializedDockview, SerializedGridviewComponent } from "dockview";
import { create } from "zustand";
import { persist } from "zustand/middleware";

type UiLayoutState = {
  layout: SerializedGridviewComponent | null;
  editorLayout: SerializedDockview | null;
  saveLayout: (layout: SerializedGridviewComponent) => void;
  saveEditorLayout: (layout: SerializedDockview) => void;
  clearLayout: () => void;
};

/**
 * The outer workbench layout: panel locations, split sizes and visibility.
 * Individual panel state belongs to its own store (for example editor tabs).
 */
export const useUiLayoutStore = create<UiLayoutState>()(
  persist(
    (set) => ({
      layout: null,
      editorLayout: null,
      saveLayout: (layout) => set({ layout }),
      saveEditorLayout: (editorLayout) => set({ editorLayout }),
      clearLayout: () => set({ layout: null, editorLayout: null }),
    }),
    {
      name: "forge.ui.workbench-layout.v1",
      // Version 2 removes the former standalone agent panel. Ignore layouts
      // from earlier versions so the workbench starts from the new structure.
      version: 2,
      partialize: (state) => ({ layout: state.layout, editorLayout: state.editorLayout }),
    },
  ),
);
