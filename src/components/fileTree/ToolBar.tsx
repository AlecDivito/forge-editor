import { FC } from "react";

import { FaAndroid, FaBug, FaFile, FaFolder, FaSync } from "react-icons/fa";

interface Props {
  onCreateFile?: () => void;
  onCreateDirectory?: () => void;
  onRefresh?: () => void;
  onDebug?: () => void;
  onTest?: () => void;
}

const ToolBar: FC<Props> = ({
  onCreateFile,
  onCreateDirectory,
  onRefresh,
  onDebug,
  onTest,
}) => {
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
        <FaBug
          className="cursor-pointer"
          size={20}
          onClick={onDebug}
          title="Debug"
        />
        <FaAndroid
          className="cursor-pointer"
          size={20}
          onClick={onTest}
          title="workspaceFolders"
        />
      </div>
    </>
  );
};

export default ToolBar;
