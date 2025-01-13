import { TreeNode } from "@/service/tree";
import { NodeRendererProps } from "react-arborist";
import { FaFile, FaFolder, FaFolderOpen } from "react-icons/fa";

const TreeItem = ({ node, style, dragHandle }: NodeRendererProps<TreeNode>) => (
  <div
    className="flex items-center space-x-2 cursor-pointer"
    style={style}
    ref={dragHandle}
    onDragStart={(event) => {
      console.log(event);
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", node.data.id);
      }
    }}
    draggable={node.data.type === "file"}
  >
    {node.isLeaf ? <FaFile /> : node.isOpen ? <FaFolderOpen /> : <FaFolder />}
    <span>{node.data.name}</span>
  </div>
);

export default TreeItem;
