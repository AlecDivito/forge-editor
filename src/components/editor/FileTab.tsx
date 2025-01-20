import { IDockviewPanelHeaderProps } from "dockview";
import { FC } from "react";
import { EditorParams } from "./EditorParams";
import { FaXbox } from "react-icons/fa";

const extractTabName = (file: string, fileList: string[] = []): string => {
  const fileName = file.split("/").pop() || file;
  const duplicate =
    fileList.filter((f) => f.split("/").pop() === fileName).length > 1;
  return duplicate ? file : fileName;
};

const FileTab: FC<IDockviewPanelHeaderProps<EditorParams>> = (props) => {
  const api = props.api;
  const { file } = props.params;

  const fileName = extractTabName(file, []);

  const close = () => {
    // TODO: Alec. All the state is kept in the editor. IF the user moves
    // to fast, they could close the editor before the changes sync. We
    // need some way of being notified of a close event and to sync the
    // changes before the document is closed.
    //
    // Theres actually a lot of things that this component should know about
    // the update process. We technically use the store to make all the edits,
    // so we should consider updating the store with this information about
    // being able to close things.
    api.close();
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
