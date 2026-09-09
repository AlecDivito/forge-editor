import { useEffect, useMemo } from "react";
import { EditorView } from "@uiw/react-codemirror";
import { WorkspaceId, FileId } from "@/lib/ws/messages";
import { useUICodeState } from "../../../hooks/use-code-ui-state.hook";
import { lintDiagnosticEffect } from "../extensions/lint.extension";

/**
 * Keeps a CodeMirror view's diagnostics in sync with the UI store for one
 * file. Dispatches a lintDiagnosticEffect whenever the store's entry for
 * this workspace/file changes, plus once immediately in case diagnostics
 * already arrived before this view existed (e.g. right after DocSubscribe).
 */
export function useDocumentDiagnosticsSync(view: EditorView | null, workspace: WorkspaceId, fileId: FileId) {
  const diagnosticObject = useUICodeState((s) => s.diagnostics);
  const diagnostics = useMemo(() => diagnosticObject[`${workspace}:${fileId}`], [workspace, fileId, diagnosticObject])

  useEffect(() => {
    if (!view || !diagnostics) return;
    console.log(diagnostics)
    view.dispatch({ effects: lintDiagnosticEffect.of(diagnostics) });
  }, [view, diagnostics]);
}