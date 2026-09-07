import { MouseEventHandler, ReactNode, useCallback, useState } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { FsFile, FsFileType } from "@/lib/generated";
import useDeleteFile from "./hooks/use-delete-file.hook";
import { cn } from "@/lib/utils";

interface Props {
  children: ReactNode;
  file: FsFile;
  className?: string;
  onRename: () => void;
  onNewFile: (ty: FsFileType) => void;
}

export default function FileMenu({ file, children, className, onRename, onNewFile }: Props) {
  const [open, setOpen] = useState(false)
  const { mutateAsync: deleteFileOp } = useDeleteFile(file);

  const newFile: MouseEventHandler<HTMLDivElement> = useCallback(async (e) => {
    e.preventDefault()
    e.stopPropagation()
    setOpen(false);
    requestAnimationFrame(() => { onNewFile(FsFileType.FILE); });
  }, [file])

  const newFolder: MouseEventHandler<HTMLDivElement> = useCallback(async (e) => {
    e.preventDefault()
    e.stopPropagation()
    setOpen(false);
    requestAnimationFrame(() => { onNewFile(FsFileType.DIRECTORY); });
  }, [file])

  const copyPath: MouseEventHandler<HTMLDivElement> = useCallback(async (e) => {
    navigator.clipboard.writeText(file.path);
    e.stopPropagation()
  }, [file])

  const rename: MouseEventHandler<HTMLDivElement> = useCallback(async (e) => {
    e.preventDefault()
    e.stopPropagation()
    setOpen(false);
    requestAnimationFrame(() => { onRename(); });
  }, [file])

  const deleteFile: MouseEventHandler<HTMLDivElement> = useCallback(async (e) => {
    e.stopPropagation()
    await deleteFileOp({ body: { path: file.path } })
  }, [file])

  return (
    <ContextMenu open={open} onOpenChange={setOpen}>
      <ContextMenuTrigger className={open ? `${className} bg-gray-300` : className}>{children}</ContextMenuTrigger>

      <ContextMenuContent className="bg-white">
        <ContextMenuItem onClick={newFile} className="hover:bg-gray-300 hover:cursor-pointer">
          New File
        </ContextMenuItem>
        <ContextMenuItem onClick={newFolder} className="hover:bg-gray-300 hover:cursor-pointer">
          New Folder
        </ContextMenuItem>
        <ContextMenuSeparator className="bg-black" />
        <ContextMenuItem onClick={copyPath} className="hover:bg-gray-300 hover:cursor-pointer">
          Copy Path
        </ContextMenuItem>
        <ContextMenuSeparator className="bg-black" />
        <ContextMenuItem onClick={rename} className="hover:bg-gray-300 hover:cursor-pointer">
          Rename
        </ContextMenuItem>
        <ContextMenuItem onClick={deleteFile} className="hover:bg-gray-300 hover:cursor-pointer">
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
