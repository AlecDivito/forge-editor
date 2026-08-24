import { FC, useCallback, useMemo, useState } from "react";
import { TreeInputItem, TreeItem } from "./TreeItem";
import useListFiles, { useInvalidateAllFileLists } from "./hooks/use-list-files.hook";
import { useEditorStore } from "@/store/editor";
import { Button } from "../ui/button";
import { AccordionContent, AccordionItem, AccordionTrigger } from "../ui/accordion";
import { FilePlus2, FolderPlus, RefreshCcw, SquareMinusIcon } from "lucide-react";
import { FsFile, FsFileType } from "@/lib/generated";
import { useFileTree } from "./providers/FileTreeProvider";
import useCreateFile from "./hooks/use-create-file.hook";

interface Props {
  path?: string;
}

const FsTreeAccordionItem: FC<Props> = ({ path = "/" }) => {
  const { data } = useListFiles({ path })
  const { openFile } = useEditorStore();
  const { open, setOpen } = useFileTree();
  const refreshFileSystem = useInvalidateAllFileLists()
  const { mutateAsync: createFileOp } = useCreateFile()
  const [newFile, setNewFile] = useState(false)
  const [newFolder, setNewFolder] = useState(false)


  const loadAndOpenFile = useCallback((path: string) => {
    openFile(`file:///${path}`);
  }, []);

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
  const genericFile = { path: "/", parent: "/" }
  const file = { ...genericFile, ty: FsFileType.FILE }
  const folder = { ...genericFile, ty: FsFileType.DIRECTORY }

  return (
    <AccordionItem value="file-system">
      <AccordionTrigger header="File System">
        <div>
          <Button size="icon" variant="ghost" onClick={() => setNewFile(true)} className="h-7 w-7 rounded-xl hover:bg-gray-300 cursor-pointer hover:text-foreground">
            <FilePlus2 className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" onClick={() => setNewFolder(true)} className="h-7 w-7 rounded-xl hover:bg-gray-300 cursor-pointer hover:text-destructive">
            <FolderPlus className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" onClick={refreshFileSystem} className="h-7 w-7 rounded-xl hover:bg-gray-300 cursor-pointer hover:text-destructive">
            <RefreshCcw className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" onClick={() => setOpen(false)} className="h-7 w-7 rounded-xl hover:bg-gray-300 cursor-pointer hover:text-destructive">
            <SquareMinusIcon className="h-3.5 w-3.5" />
          </Button>
        </div>
      </AccordionTrigger>
      <AccordionContent>
        <div className="flex flex-col h-full w-full">
          {newFolder && <TreeInputItem file={folder} onComplete={path => createFile(folder, path)} onDismiss={() => setNewFolder(false)} />}
          {folders.map(file => <TreeItem key={file.path} file={file} level={0} path={file.path} onSelect={loadAndOpenFile} />)}
          {newFile && <TreeInputItem file={file} onComplete={path => createFile(file, path)} onDismiss={() => setNewFile(false)} />}
          {files.map(file => <TreeItem key={file.path} file={file} level={0} path={file.path} onSelect={loadAndOpenFile} />)}
        </div>
      </AccordionContent>
    </AccordionItem>


  );
};

export default FsTreeAccordionItem;
