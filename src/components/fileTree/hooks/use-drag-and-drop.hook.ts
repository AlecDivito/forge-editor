import { useCallback, useRef, useState } from "react";
import { FsFile, FsFileType } from "@/lib/generated";
import { useFileTree } from "../providers/FileTreeProvider";
import useRenameFile from "./use-rename-file.hook";

const HOVER_EXPAND_DELAY = 600;

const isDescendantOrSelf = (parentPath: string, candidatePath: string) => {
  const normalized = parentPath.endsWith("/") ? parentPath : `${parentPath}/`;
  return candidatePath === parentPath || candidatePath.startsWith(normalized);
};

/**
 * Makes any tree item (file or folder) a drag source.
 */
export function useDragSource(file: FsFile) {
  const { setDraggedPath } = useFileTree();

  const onDragStart = useCallback(
    (e: React.DragEvent) => {
      e.stopPropagation();
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", file.path);
      setDraggedPath(file.path);
    },
    [file.path, setDraggedPath]
  );

  const onDragEnd = useCallback(
    (e: React.DragEvent) => {
      e.stopPropagation();
      setDraggedPath(null);
    },
    [setDraggedPath]
  );

  return { draggable: true, onDragStart, onDragEnd };
}

/**
 * Makes a folder a valid drop target. Handles the actual move via
 * useRenameFile (a move is just a rename to a new parent path).
 */
export function useDropTarget(file: FsFile, options?: { onHoverExpand?: () => void }) {
  const { draggedPath, setDraggedPath } = useFileTree();
  const { mutateAsync: renameFileOp } = useRenameFile(file);
  const [isDragOver, setIsDragOver] = useState(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearHoverTimer = () => {
    if (hoverTimer.current) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  };

  const canDrop = useCallback(
    (sourcePath: string | null) => {
      if (!sourcePath) return false;
      if (file.ty !== FsFileType.DIRECTORY) return false;
      if (isDescendantOrSelf(sourcePath, file.path)) return false;
      return true;
    },
    [file.path, file.ty]
  );

  const onDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!canDrop(draggedPath)) return;
      e.preventDefault(); // required for onDrop to fire
      e.stopPropagation();
      e.dataTransfer.dropEffect = "move";
      setIsDragOver(true);

      if (options?.onHoverExpand && !hoverTimer.current) {
        hoverTimer.current = setTimeout(() => {
          options.onHoverExpand?.();
        }, HOVER_EXPAND_DELAY);
      }
    },
    [canDrop, draggedPath, options]
  );

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.stopPropagation();
    setIsDragOver(false);
    clearHoverTimer();
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      clearHoverTimer();

      const sourcePath = e.dataTransfer.getData("text/plain") || draggedPath;
      setDraggedPath(null);

      if (!canDrop(sourcePath)) return;

      const name = sourcePath!.split("/").filter(Boolean).pop();
      const destParent = file.path.endsWith("/") ? file.path : `${file.path}/`;
      const to = `${destParent}${name}`;

      if (to === sourcePath) return; // dropped into its own parent, no-op

      renameFileOp({ body: { from: sourcePath!, to } });
    },
    [canDrop, draggedPath, file.path, renameFileOp, setDraggedPath]
  );

  return { isDragOver, onDragOver, onDragLeave, onDrop };
}