import { useEffect, useMemo } from "react";
import { EditorView } from "@uiw/react-codemirror";
import { WorkspaceId, FileId } from "@/lib/ws/messages";
import { documentKey, emptyDiagnostics, useDiagnosticsStore } from "../../../state/diagnostics.store";
import { lintDiagnosticEffect } from "../extensions/lint.extension";

/**
 * Keeps a CodeMirror view's diagnostics in sync with the UI store for one
 * file. Dispatches a lintDiagnosticEffect whenever the store's entry for
 * this workspace/file changes, plus once immediately in case diagnostics
 * already arrived before this view existed (e.g. right after DocSubscribe).
 */
export function useDocumentDiagnosticsSync(view: EditorView | null, workspace: WorkspaceId, fileId: FileId) {
  const key = useMemo(() => documentKey(workspace, fileId), [workspace, fileId]);
  const diagnostics = useDiagnosticsStore((state) => state.byDocument[key] ?? emptyDiagnostics);

  useEffect(() => {
    if (!view) return;
    view.dispatch({ effects: lintDiagnosticEffect.of(diagnostics) });
  }, [view, diagnostics]);
}
