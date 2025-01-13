import { IDockviewPanelHeaderProps } from "dockview";
import { FC } from "react";
import { EditorParams } from "./EditorParams";
import { useFileStore } from "@/store";
import { FaXbox } from "react-icons/fa";

const extractTabName = (file: string, fileList: string[] = []): string => {
  const fileName = file.split("/").pop() || file;
  const duplicate =
    fileList.filter((f) => f.split("/").pop() === fileName).length > 1;
  return duplicate ? file : fileName;
};

const FileTab: FC<IDockviewPanelHeaderProps<EditorParams>> = (props) => {
  const panels = useFileStore((state) => state.openFiles);
  const closePanel = useFileStore((state) => state.closeFile);
  const api = props.api;
  const { file, group } = props.params;

  const fileName = extractTabName(file, panels[api.group.id]);

  const close = () => {
    closePanel(group, file);
  };

  return (
    <div className="dv-default-tab">
      <div className="dv-default-tab-content">{fileName}</div>
      <div className="dv-default-tab-action" onClick={close}>
        <FaXbox />
      </div>
    </div>
  );
};

export default FileTab;
