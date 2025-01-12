import useResizeObserver from "@/hooks/use-resize-observer";
import { TreeNode } from "@/service/tree";
import { FC } from "react";
import { NodeRendererProps, Tree } from "react-arborist";
import { FaFile, FaFolder, FaFolderOpen } from "react-icons/fa";

const Node = ({ node, style, dragHandle }: NodeRendererProps<TreeNode>) => (
  <div
    className="flex items-center space-x-2 cursor-pointer"
    style={style}
    ref={dragHandle}
  >
    {node.isLeaf ? <FaFile /> : node.isOpen ? <FaFolderOpen /> : <FaFolder />}
    <span>{node.data.name}</span>
  </div>
);

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
        {Node}
      </Tree>
    </div>
  );
};

export default FsTree;
