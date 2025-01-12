import { FC } from "react";

import { FaFile, FaFolder, FaSync } from "react-icons/fa";

interface Props {
  onCreateFile?: () => void;
  onCreateDirectory?: () => void;
  onRefresh?: () => void;
}

const ToolBar: FC<Props> = ({ onCreateFile, onCreateDirectory, onRefresh }) => {
  return (
    <>
      <div className="flex items-center space-x-4 p-2">
        <FaFile
          className="cursor-pointer"
          size={20}
          onClick={onCreateFile}
          title="Create File"
        />
        <FaFolder
          className="cursor-pointer"
          size={20}
          onClick={onCreateDirectory}
          title="Create Directory"
        />
        <FaSync
          className="cursor-pointer"
          size={20}
          onClick={onRefresh}
          title="Refresh"
        />
      </div>
    </>
  );
};

export default ToolBar;
