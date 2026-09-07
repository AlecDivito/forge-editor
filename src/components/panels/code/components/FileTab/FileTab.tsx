// components/FileTab/FileTab.tsx
import { IDockviewPanelHeaderProps } from "dockview";
import { FC } from "react";
import { FaTimes } from "react-icons/fa";
import { FileIcon } from "lucide-react";
import { PanelDescriptor, titleFor, useUICodeState } from "../../hooks/use-code-ui-state.hook";

const FileTab: FC<IDockviewPanelHeaderProps<PanelDescriptor>> = (props) => {
  const panel = props.params;
  const closeFile = useUICodeState((s) => s.closeFile);
  const openPanels = useUICodeState((s) => s.openPanels);

  const fileName = titleFor(panel, openPanels);
  // const status = useDocumentStatus(panel.workspace, panel.fileId);
  // const isDirty = status?.kind === "ready" && status.dirty;

  return (
    <div className="dv-default-tab">
      <div className="dv-default-tab-content flex items-center gap-1.5">
        <FileIcon size={14} className="shrink-0" />
        <span className="truncate">{fileName}</span>
        {/* isDirty && */ <span className="w-1.5 h-1.5 rounded-full bg-neutral-400" aria-label="unsaved changes" />}
      </div>
      <div
        className="dv-default-tab-action"
        onClick={(e) => {
          e.stopPropagation(); // don't let the click also activate/drag the tab
          closeFile(panel.id); // panel id, not fileId — closeFile removes by dockview panel id
        }}
      >
        <FaTimes />
      </div>
    </div>
  );
};

export default FileTab;