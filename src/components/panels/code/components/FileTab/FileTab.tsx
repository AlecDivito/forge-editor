// components/FileTab/FileTab.tsx
import { IDockviewPanelHeaderProps } from "dockview";
import { FC } from "react";
import { AlertCircle, Circle, FileIcon, Loader2, X } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { CodePanelDescriptor, selectPanels, useEditorSessionStore } from "../../state/editor-session.store";
import { titleFor } from "../../state/panel-title";
import { useDocumentLifecycle } from "@/hooks/use-document-lifecycle.hook";

const FileTab: FC<IDockviewPanelHeaderProps<CodePanelDescriptor>> = (props) => {
  const panel = props.params;
  const requestClose = useEditorSessionStore((s) => s.requestClose);
  const openPanels = useEditorSessionStore(useShallow(selectPanels));
  const lifecycle = useDocumentLifecycle(panel.workspace, panel.fileId);

  const fileName = titleFor(panel, openPanels);
  const status = lifecycle.phase === "pending" || lifecycle.phase === "offline"
    ? <Circle aria-hidden="true" className="h-2 w-2 fill-current text-amber-400" />
    : lifecycle.phase === "saving"
      ? <Loader2 aria-hidden="true" className="h-3 w-3 animate-spin text-blue-400" />
      : lifecycle.phase === "save_error" || lifecycle.phase === "deleted"
        ? <AlertCircle aria-hidden="true" className="h-3 w-3 text-red-400" />
        : lifecycle.phase === "loading"
          ? <Loader2 aria-hidden="true" className="h-3 w-3 animate-spin text-muted-foreground" />
          : null;
  const statusText = lifecycle.phase === "pending" ? "Unsaved changes"
    : lifecycle.phase === "saving" ? "Saving …"
      : lifecycle.phase === "save_error" ? `Save failed${lifecycle.error ? `: ${lifecycle.error}` : ""}`
        : lifecycle.phase === "offline" ? "Unsaved changes; offline"
          : lifecycle.phase === "deleted" ? "File deleted; unsaved changes may be recoverable"
        : lifecycle.phase === "loading" ? "Loading document …" : undefined;
  const isDirty = lifecycle.dirty || lifecycle.phase === "pending" || lifecycle.phase === "saving" ||
    lifecycle.phase === "save_error" || lifecycle.phase === "offline";

  return (
    <div className="dv-default-tab file-tab" title={panel.fileId}>
      <div className="dv-default-tab-content file-tab-content flex items-center gap-1.5">
        <FileIcon aria-hidden="true" size={14} className="file-tab-icon shrink-0" />
        <span className="file-tab-name truncate">{fileName}</span>
        {status && <span role="status" aria-label={statusText} title={statusText}>{status}</span>}
        {isDirty && !status && (
          <Circle aria-hidden="true" className="file-tab-dirty h-2 w-2 shrink-0 fill-current" />
        )}
      </div>
      <button
        type="button"
        className="dv-default-tab-action"
        aria-label={`Close ${fileName}`}
        title={`Close ${fileName}`}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          requestClose(panel.id);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            event.stopPropagation();
            requestClose(panel.id);
          }
        }}
      >
        <X aria-hidden="true" size={14} />
      </button>
    </div>
  );
};

export default FileTab;
