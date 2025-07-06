import { ReactNode } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "../ui/context-menu";
import { useCommandQueue } from "@/store/commands";
import { FileNode } from "@/utils/filetree";

interface Props {
  children: ReactNode;
  node?: FileNode;
  className?: string;
}

const getParent = (node: FileNode) => {
  if (node.type === "d") {
    return node.path;
  }
  const parts = node.path.split("/");
  if (parts.length === 1) {
    return "/";
  } else {
    return parts.splice(0, parts.length - 1).join("/");
  }
};

export default function FileMenu({ node, children, className, canRename = false }: Props) {
  const { push } = useCommandQueue();

  return (
    <ContextMenu>
      <ContextMenuTrigger className={className}>{children}</ContextMenuTrigger>

      <ContextMenuContent>
        <ContextMenuItem
          onClick={(e) => {
            e.stopPropagation();
            push({ parent: node ? getParent(node) : "", type: "file.new" });
          }}>
          New File
        </ContextMenuItem>
        <ContextMenuItem
          onClick={(e) => {
            e.stopPropagation();
            push({ parent: node ? getParent(node) : "", type: "folder.new" });
          }}>
          New Folder
        </ContextMenuItem>
        <ContextMenuSeparator />
        {/* <ContextMenuItem>Open in Terminal</ContextMenuItem>
        <ContextMenuSeparator /> */}
        {/* <ContextMenuItem>Cut</ContextMenuItem>
        <ContextMenuItem>Copy</ContextMenuItem>
        <ContextMenuItem>Duplicate</ContextMenuItem>
        <ContextMenuItem>Paste</ContextMenuItem>
        <ContextMenuSeparator /> */}
        <ContextMenuItem
          onClick={(e) => {
            e.stopPropagation();
            push({ type: "copy.abs.path" });
          }}>
          Copy Absolute Path
        </ContextMenuItem>
        <ContextMenuItem
          onClick={(e) => {
            e.stopPropagation();
            push({ type: "copy.rel.path" });
          }}>
          Copy Relative Path
        </ContextMenuItem>
        {node && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              onClick={(e) => {
                e.stopPropagation();
                push({ path: node.path, type: "rename.prepare" });
              }}>
              Rename
            </ContextMenuItem>
            <ContextMenuItem
              onClick={(e) => {
                e.stopPropagation();
                push({ path: node.path, type: "delete" });
              }}>
              Delete
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
