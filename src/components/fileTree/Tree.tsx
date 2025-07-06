import { FC } from "react";
import { TreeFolderItem } from "./TreeItem";
import { FileNode } from "@/utils/filetree";
import FileMenu from "./FileMenu";

interface Props {
  node: FileNode;
  level?: number;
  onSelect?: (fileName: string) => void;
}

const Rating: Record<FileNode["type"], number> = {
  d: 10,
  f: 5,
  createFile: 1,
  createFolder: 1,
};

const FsTree: FC<Props> = ({ node, onSelect, level = 0 }) => {
  (node?.children || []).sort((a, b) => Rating[b.type] - Rating[a.type]);

  return (
    <div className="flex flex-col h-full w-full">
      <div>
        <TreeFolderItem node={node} level={level} onSelect={onSelect} />
      </div>
      <FileMenu className="h-full w-full block">
        <div className="h-full w-full block">
          <span></span>
        </div>
      </FileMenu>
    </div>
  );
};

export default FsTree;
