import { EditorState, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import { EditorView, GutterMarker, ViewPlugin, ViewUpdate, gutter } from "@codemirror/view";
import { getBreakpoints, useBreakpointStore } from "../../../state/breakpoints.store";
import { DocumentFileId, DocumentWorkspaceId } from "./state.extension";

class BreakpointMarker extends GutterMarker {
  toDOM() {
    const marker = document.createElement("span");
    marker.className = "cm-breakpoint-marker";
    marker.setAttribute("aria-label", "Breakpoint");
    return marker;
  }
}

const breakpointMarker = new BreakpointMarker();
const replaceBreakpoints = StateEffect.define<readonly number[]>();

function linesForState(state: EditorState): readonly number[] {
  const workspace = state.facet(DocumentWorkspaceId);
  const fileId = state.facet(DocumentFileId);
  return workspace && fileId ? getBreakpoints(workspace, fileId).map((breakpoint) => breakpoint.line) : [];
}

function markersForLines(state: EditorState, lines: readonly number[]) {
  const markers = new RangeSetBuilder<BreakpointMarker>();
  for (const line of lines) {
    if (line <= state.doc.lines) markers.add(state.doc.line(line).from, state.doc.line(line).from, breakpointMarker);
  }
  return markers.finish();
}

const breakpointState = StateField.define({
  create: (state) => markersForLines(state, linesForState(state)),
  update: (markers, transaction) => {
    markers = markers.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(replaceBreakpoints)) return markersForLines(transaction.state, effect.value);
    }
    return markers;
  },
  provide: (field) =>
    gutter({
      class: "cm-breakpoint-gutter",
      markers: (view) => view.state.field(field),
      initialSpacer: () => breakpointMarker,
      renderEmptyElements: true,
      domEventHandlers: {
        mousedown: (view, line, event) => {
          if (event.button !== 0) return false;
          const workspace = view.state.facet(DocumentWorkspaceId);
          const fileId = view.state.facet(DocumentFileId);
          if (!workspace || !fileId) return false;
          event.preventDefault();
          const lineNumber = view.state.doc.lineAt(line.from).number;
          const breakpoints = useBreakpointStore.getState().toggle(workspace, fileId, lineNumber);
          view.dispatch({ effects: replaceBreakpoints.of(breakpoints.map((breakpoint) => breakpoint.line)) });
          return true;
        },
      },
    }),
});

function markerLines(state: EditorState): readonly number[] {
  const lines: number[] = [];
  state.field(breakpointState).between(0, state.doc.length, (from) => lines.push(state.doc.lineAt(from).number));
  return lines;
}

const persistBreakpointPositions = ViewPlugin.fromClass(
  class {
    update(update: ViewUpdate) {
      if (!update.docChanged) return;
      const workspace = update.state.facet(DocumentWorkspaceId);
      const fileId = update.state.facet(DocumentFileId);
      if (workspace && fileId) {
        useBreakpointStore.getState().set(workspace, fileId, markerLines(update.state).map((line) => ({ line })));
      }
    }
  },
);

const breakpointTheme = EditorView.baseTheme({
  ".cm-breakpoint-gutter": { minWidth: "1.75rem", cursor: "pointer" },
  ".cm-breakpoint-gutter .cm-gutterElement": { display: "grid", placeItems: "center", padding: 0 },
  ".cm-breakpoint-marker": {
    width: "0.625rem",
    height: "0.625rem",
    borderRadius: "999px",
    backgroundColor: "var(--destructive)",
    boxShadow: "0 0 0 1px var(--background)",
  },
});

/**
 * A document-scoped, clickable gutter. Its backing Zustand store is the
 * integration point for a future debug adapter; this extension only renders
 * and edits the local source-level breakpoint intent.
 */
export const breakpointExtension = [breakpointState, persistBreakpointPositions, breakpointTheme];
