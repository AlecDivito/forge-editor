import { FC, useCallback, useMemo, useState } from "react";
import { TreeInputItem, TreeItem } from "./TreeItem";
import useListFiles, { useInvalidateAllFileLists } from "./hooks/use-list-files.hook";
import { useEditorStore } from "@/store/editor";
import { FilePlus2, FolderPlus, RefreshCcw, SquareMinusIcon, SquarePlusIcon } from "lucide-react";
import { FsFile, FsFileType } from "@/lib/generated";
import { useFileTree } from "./providers/FileTreeProvider";
import useCreateFile from "./hooks/use-create-file.hook";
import { useDropTarget } from "./hooks/use-drag-and-drop.hook";
import { AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Button } from "@/components/ui/button";
import { useUICodeState } from "@/components/panels/code/hooks/use-code-ui-state.hook";
import { FileId, WorkspaceId } from "@/lib/ws/messages";

interface Props {
  path?: string;
}

const FsTreeAccordionItem: FC<Props> = ({ path = "/" }) => {
  const { data } = useListFiles({ path })
  const { open, setOpen } = useFileTree();
  const openFile = useUICodeState((s) => s.openFile);
  const refreshFileSystem = useInvalidateAllFileLists()
  const { mutateAsync: createFileOp } = useCreateFile()
  const [newFile, setNewFile] = useState(false)
  const [newFolder, setNewFolder] = useState(false)
  const genericFile = { path: "/", parent: "/" }
  const file = { ...genericFile, ty: FsFileType.FILE }
  const folder = { ...genericFile, ty: FsFileType.DIRECTORY }

  // Root is a drop target (files/folders can be dropped here to move
  // them to "/"), not a drag source — you don't drag the root itself.
  const dropTarget = useDropTarget(folder as FsFile, {
    onHoverExpand: () => setOpen(true),
  });

  const loadAndOpenFile = useCallback((path: string) => {
    openFile("" as WorkspaceId, path as FileId);
  }, [openFile]);

  const createFile = useCallback((file: FsFile, path: string) => {
    setNewFile(false)
    setNewFolder(false)
    createFileOp({
      body: {
        path,
        ty: file.ty
      }
    })
  }, [])

  const folders = useMemo(() => data?.files.filter(f => f.ty === FsFileType.DIRECTORY) || [], [data])
  const files = useMemo(() => data?.files.filter(f => f.ty === FsFileType.FILE) || [], [data])

  const options = useMemo(() => [
    {
      Icon: FilePlus2,
      title: 'New file',
      onClick: () => setNewFile(true),
    },
    {
      Icon: FolderPlus,
      title: 'New folder',
      onClick: () => setNewFolder(true),
    },
    {
      Icon: RefreshCcw,
      title: 'Refresh Explorer',
      onClick: refreshFileSystem,
      // Hmm, this one is interesting, i think we'll be able to
      // do it, but we'll need to open this component in a tab
    },
    {
      Icon: open ? SquareMinusIcon : SquarePlusIcon,
      title: 'Collapse Folders in Explorer',
      onClick: () => setOpen(!open),
    },
  ], [open, setOpen, refreshFileSystem])

  return (
    <AccordionItem value="file-system">
      <AccordionTrigger header="File System">
        <div>
          {options.map(({ Icon, title, onClick }) =>
            <HoverCard key={title}>
              <HoverCardTrigger asChild>
                <Button size="sm" variant='ghost' className="p-2" onClick={onClick}>
                  <Icon className="h-4 w-4" />
                </Button>
              </HoverCardTrigger>
              <HoverCardContent className="p-2 w-fit z-50 bg-white">
                {title}
              </HoverCardContent>
            </HoverCard>
          )}
        </div>
      </AccordionTrigger>
      <AccordionContent className="pt-1">
        <div
          className={`flex flex-col h-full w-full min-h-4 pb-8 box-border ${dropTarget.isDragOver ? "bg-secondary outline-1 outline-secondary-foreground outline-dashed" : ""}`}
          onDragOver={dropTarget.onDragOver}
          onDragLeave={dropTarget.onDragLeave}
          onDrop={dropTarget.onDrop}
        >
          {newFolder && <TreeInputItem file={folder} onComplete={path => createFile(folder, path)} onDismiss={() => setNewFolder(false)} />}
          {folders.map(file => <TreeItem key={file.path} file={file} level={0} path={file.path} onSelect={loadAndOpenFile} />)}
          {newFile && <TreeInputItem file={file} onComplete={path => createFile(file, path)} onDismiss={() => setNewFile(false)} />}
            <div className="ml-6">

          {files.map(file => <TreeItem key={file.path} file={file} level={0} path={file.path} onSelect={loadAndOpenFile} />)}
            </div>
        </div>
      </AccordionContent>
    </AccordionItem>
  );
};

export default FsTreeAccordionItem;
