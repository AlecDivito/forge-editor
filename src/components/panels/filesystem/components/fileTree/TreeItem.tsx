import { FaFile, FaFolder, FaFolderOpen } from "react-icons/fa";
import FileMenu from "./FileMenu";
import { MouseEventHandler, SubmitEventHandler, useCallback, useEffect, useMemo, useRef, useState } from "react";
import useListFiles from "./hooks/use-list-files.hook";
import { FsFile, FsFileType } from "@/lib/generated";
import { Spinner } from "@/components/ui/spinner";
import useRenameFile from "./hooks/use-rename-file.hook";
import { useFileTree } from "./providers/FileTreeProvider";
import useCreateFile from "./hooks/use-create-file.hook";
import { useDragSource, useDropTarget } from "./hooks/use-drag-and-drop.hook";
import { Input } from "@/components/ui/input";
import FileDropdownToggle from "../fileSearch/components/FileDropdownToggle";

interface Props {
  file: FsFile;
  level: number;
  path?: string;
  onSelect?: (fileName: string) => void;
}

export const TreeItem = ({ file, onSelect, level, path = '/' }: Props) => {
  if (file.ty === FsFileType.DIRECTORY) {
    return <TreeFolderItem file={file} level={level} path={file.path} onSelect={onSelect} />
  } else if (file.ty === FsFileType.FILE) {
    return <TreeFileItem file={file} onSelect={onSelect} level={level} />
  } else {
    return null
  }
}

const TreeFileItem = ({ file, onSelect, level }: Props) => {
  const { workspaceId } = useFileTree();
  const [isEditing, setIsEditing] = useState(false);
  const [newFileType, setNewFileType] = useState<FsFileType | undefined>(undefined);
  const { mutateAsync: renameFileOp } = useRenameFile(workspaceId, file)
  const { mutateAsync: createFileOp } = useCreateFile(workspaceId, file)

  // Files are drag sources only — they can't accept drops.
  const dragSource = useDragSource(file);

  const enableRenameFile = () => setIsEditing(true)
  const disableRenameFile = () => setIsEditing(false)
  const disableNewFile = () => setNewFileType(undefined)

  const createFile = useCallback((path: string) => {
    if (newFileType) {
      createFileOp({ query: { workspace_id: workspaceId }, body: { path, ty: newFileType } })
      disableNewFile()
    }
  }, [newFileType])

  const renameFile = useCallback((newPath: string) => {
    renameFileOp({ query: { source_workspace_id: workspaceId, destination_workspace_id: workspaceId }, body: { from: file.path, to: newPath } })
    disableRenameFile()
  }, [])

  if (!isEditing) {
    return (
      <>
        <FileMenu file={file} onRename={enableRenameFile} onNewFile={setNewFileType}>
          <div
            {...dragSource}
            onClick={(event) => {
              event.stopPropagation();
              onSelect?.(file.path);
            }}
            className={`space-x-2 cursor-pointer`}
            style={{ paddingLeft: level === 0 ? `6px` : `30px` }}
          >
            <span className="flex items-center space-x-2 cursor-pointer hover:bg-accent hover:text-accent-foreground">
              <FaFile className="text-accent-foreground" />
              <span>{file.name}</span>
            </span>
          </div>
        </FileMenu>
        {newFileType && <TreeInputItem file={{ ...file, ty: newFileType }} onComplete={createFile} onDismiss={disableNewFile} />}
      </>
    );
  } else {
    return <div className="flex items-center space-x-2 cursor-pointer">
      <TreeInputItem file={file} onComplete={renameFile} onDismiss={disableRenameFile} />
    </div>
  }
};

const TreeFolderItem = ({ file, onSelect, path = '/', level }: Props) => {
  const { open: globalOpen, setOpen: setGlobalOpen, workspaceId } = useFileTree();
  const [open, setOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const { data, isLoading } = useListFiles({ workspaceId, path, enabled: open })

  const [newFileType, setNewFileType] = useState<FsFileType | undefined>(undefined);
  const { mutateAsync: renameFileOp } = useRenameFile(workspaceId, file)
  const { mutateAsync: createFileOp } = useCreateFile(workspaceId, file, true)

  // Folders are both drag sources (can be moved) and drop targets
  // (can receive other files/folders). Hovering with a drag auto-expands.
  const dragSource = useDragSource(file);
  const dropTarget = useDropTarget(file, {
    onHoverExpand: () => setOpen(true),
  });

  const enableRenameFile = () => setIsEditing(true)
  const disableRenameFile = () => setIsEditing(false)
  const enableNewFile = (ty: FsFileType) => {
    setOpen(true)
    setNewFileType(ty)
  }
  const disableNewFile = () => setNewFileType(undefined)

  const createFile = useCallback((path: string) => {
    if (newFileType) {
      createFileOp({ query: { workspace_id: workspaceId }, body: { path, ty: newFileType } })
      disableNewFile()
    }
  }, [newFileType])

  const renameFile = useCallback((newPath: string) => {
    renameFileOp({ query: { source_workspace_id: workspaceId, destination_workspace_id: workspaceId }, body: { from: file.path, to: newPath } })
    disableRenameFile()
  }, [])

  const click: MouseEventHandler<HTMLDivElement> = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation()
    setOpen(!open)
    if (!globalOpen) {
      setGlobalOpen(true)
    }
  }, [setOpen, open, globalOpen, setGlobalOpen])

  useEffect(() => {
    if (!globalOpen) {
      setOpen(false)
    }
  }, [globalOpen])

  const isOpen = open && globalOpen
  const files = useMemo(() => isOpen ? data?.files || [] : [], [data, open, globalOpen])

  if (!isEditing) {
    return (
      <>
        <FileMenu file={file} onRename={enableRenameFile} onNewFile={enableNewFile}>
          <div
            {...dragSource}
            onDragOver={dropTarget.onDragOver}
            onDragLeave={dropTarget.onDragLeave}
            onDrop={dropTarget.onDrop}
            onClick={click}
            style={{ paddingLeft: `6px` }}
            className={`${dropTarget.isDragOver ? "bg-secondary outline-1 outline-secondary-foreground" : undefined}`}
          >
            <div className={`flex gap-2`}>
              <FileDropdownToggle expanded={isOpen} />
              <div className={`flex flex-row items-center space-x-2 cursor-pointer hover:bg-accent hover:text-accent-foreground`}>
                {isLoading ? <Spinner className="text-accent-foreground" /> : isOpen ? <FaFolderOpen className="text-accent-foreground" /> : <FaFolder className="text-accent-foreground" />}
                <span>{file?.name}</span>
              </div>
            </div>
            <div className="ml-1.5 border-l border-border">
              {files?.map(file => <TreeItem key={file.path} file={file} level={level + 1} onSelect={onSelect} />)}
            </div>
          </div>
        </FileMenu>
        {newFileType && <TreeInputItem file={{ ...file, parent: file.path, ty: newFileType }} onComplete={createFile} onDismiss={disableNewFile} indent />}
      </>
    );
  } else {
    return <TreeInputItem file={file} onComplete={renameFile} onDismiss={disableRenameFile} />
  }
};

type TreeInputItemProps = Pick<Props, 'file'> & {
  indent?: boolean
  onComplete: (path: string) => void;
  onDismiss: () => void;
};

export const TreeInputItem = ({ file, onComplete, onDismiss, indent = false }: TreeInputItemProps) => {
  const [state, setState] = useState(file.name || '');
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const getPath = useCallback(() => {
    if (file.parent.endsWith('/')) {
      return `${file.parent}${state}`;
    }

    return `${file.parent}/${state}`;
  }, [file.path, state]);

  const submit = useCallback<SubmitEventHandler<HTMLFormElement>>((e) => {
    e.preventDefault();
    if (!state.trim() || state === file.name) {
      onDismiss();
      return;
    }

    onComplete(getPath());
  },
    [state, file, getPath, onComplete, onDismiss]
  );

  const handleBlur = useCallback(() => {
    if (!state.trim() || state === file.name) {
      onDismiss();
      return;
    }

    onComplete(getPath());
  }, [state, file, getPath, onComplete, onDismiss]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onDismiss();
      }
    },
    [onDismiss]
  );

  return (
    <div
      className="flex items-center gap-2"
      style={{ paddingLeft: !indent ? '6px' : '24px' }}
    >
      {file.ty === FsFileType.FILE ? <FaFile /> : <FaFolder />}

      <form onSubmit={submit}>
        <Input
          ref={ref}
          value={state}
          onChange={(e) => setState(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          className="h-5 p-0.5 text-sm"
        />
      </form>
    </div>
  );
};
