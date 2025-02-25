import { FC } from "react";
import { Tree } from "react-arborist";
import TreeItem from "./TreeItem";
import { FileNode } from "@/utils/filetree";

interface Props {
  files?: FileNode[];
  onSelect?: (fileName: string) => void;
}

const FsTree: FC<Props> = ({ files, onSelect }) => {
  return (
    <Tree
      data={files}
      openByDefault={false}
      indent={24}
      rowHeight={24}
      onSelect={(node) => {
        if (node.length > 0) {
          if (node[0].data.type === "d") {
            node[0].toggle();
            for (const item of node[0].children || []) {
              item.toggle();
            }
          } else {
            onSelect?.(node[0].data.path);
          }
        }
      }}>
      {TreeItem}
    </Tree>
  );
};

export default FsTree;
