import { FC, MouseEvent, useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { saveDocument } from "@/lib/documents/save";
import { getDocumentLifecycle } from "@/lib/documents/registry";
import { useDocumentLifecycle } from "@/hooks/use-document-lifecycle.hook";
import { useEditorSessionStore } from "../../state/editor-session.store";

const unsafePhase = (phase?: string) => phase === "pending" || phase === "saving" ||
  phase === "save_error" || phase === "offline" || phase === "deleted";

const CloseConfirmationDialog: FC = () => {
  const panelId = useEditorSessionStore((s) => s.pendingClosePanelId);
  const open = panelId !== null;
  const panel = useEditorSessionStore((s) => {
    const candidate = panelId ? s.panelsById[panelId] : undefined;
    return candidate?.kind === "code" ? candidate : undefined;
  });
  const closePanel = useEditorSessionStore((s) => s.closePanel);
  const cancelClose = useEditorSessionStore((s) => s.cancelClose);
  const lifecycle = useDocumentLifecycle(panel?.workspace, panel?.fileId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setBusy(false);
      setError(null);
    }
  }, [open, panelId]);

  const saveAndClose = async (event: MouseEvent) => {
    event.preventDefault();
    if (!panel?.fileId || busy) return;
    setBusy(true);
    setError(null);
    try {
      await saveDocument(panel.workspace, panel.fileId);
      const current = getDocumentLifecycle(panel.workspace, panel.fileId);
      if (!current || current.dirty || unsafePhase(current.phase)) {
        setError("The document changed while it was being saved. Review the newer edits before closing.");
        return;
      }
      closePanel(panel.id);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen && !busy) cancelClose(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Unsaved changes</AlertDialogTitle>
          <AlertDialogDescription>
            {panel?.fileId ? `${panel.fileId} has changes that have not been safely persisted.` : "This document has changes that have not been safely persisted."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {lifecycle.error && <p role="alert" className="text-sm text-destructive">{lifecycle.error}</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Keep Editing</AlertDialogCancel>
          <Button type="button" variant="destructive" disabled={busy} onClick={() => closePanel(panel?.id ?? "")}>
            Close Anyway
          </Button>
          <AlertDialogAction disabled={busy} onClick={saveAndClose}>
            {busy ? "Saving …" : "Save and Close"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default CloseConfirmationDialog;
