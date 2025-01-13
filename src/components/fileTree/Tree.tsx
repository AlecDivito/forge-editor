import useResizeObserver from "@/hooks/use-resize-observer";
import { TreeNode } from "@/service/tree";
import { FC } from "react";
import { Tree } from "react-arborist";
import TreeItem from "./TreeItem";

interface Props {
  files?: TreeNode[];
  onSelect?: (fileName: string) => void;
}

const FsTree: FC<Props> = ({ files, onSelect }) => {
  const { ref, width, height } = useResizeObserver();

  return (
    <div className="flex-grow" style={{ minBlockSize: 0 }} ref={ref}>
      <Tree
        width={width}
        height={height}
        data={files}
        openByDefault={false}
        indent={24}
        rowHeight={24}
        onSelect={(node) => {
          if (node.length > 0) {
            if (node[0].data.type === "directory") {
              console.log(node[0]);
              node[0].toggle();
              for (const item of node[0].children || []) {
                console.log(item);
                item.toggle();
              }
            } else {
              onSelect?.(node[0].data.id);
            }
          }
        }}
      >
        {TreeItem}
      </Tree>
    </div>
  );
};

export default FsTree;
