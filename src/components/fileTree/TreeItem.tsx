import { FaFile, FaFolder, FaFolderOpen } from "react-icons/fa";
import FileMenu from "./FileMenu";
import { MouseEventHandler, SubmitEventHandler, useCallback, useEffect, useMemo, useRef, useState } from "react";
import useListFiles from "./hooks/use-list-files.hook";
import { FsFile, FsFileType } from "@/lib/generated";
import { Spinner } from "../ui/spinner";
import useRenameFile from "./hooks/use-rename-file.hook";
import { useFileTree } from "./providers/FileTreeProvider";
import useCreateFile from "./hooks/use-create-file.hook";

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

const TreeFileItem = ({ file, onSelect }: Props) => {
  const [isEditing, setIsEditing] = useState(false);
  const [newFileType, setNewFileType] = useState<FsFileType | undefined>(undefined);
  const { mutateAsync: renameFileOp } = useRenameFile(file)
  const { mutateAsync: createFileOp } = useCreateFile(file)

  const enableRenameFile = () => setIsEditing(true)
  const disableRenameFile = () => setIsEditing(false)
  const disableNewFile = () => setNewFileType(undefined)

  const createFile = useCallback((path: string) => {
    console.log('wow', newFileType)
    if (newFileType) {
      createFileOp({ body: { path, ty: newFileType } })
      disableNewFile()
    }
  }, [newFileType])

  const renameFile = useCallback((newPath: string) => {
    renameFileOp({ body: { from: file.path, to: newPath } })
    disableRenameFile()
  }, [])

  if (!isEditing) {
    return (
      <>
        <FileMenu file={file} onRename={enableRenameFile} onNewFile={setNewFileType}>
          <div onClick={() => onSelect?.(file.path)} className=" space-x-2 cursor-pointer" style={{ paddingLeft: `12px` }}>
            <span className="flex items-center space-x-2 cursor-pointer hover:bg-gray-300">
              <FaFile />
              <span>{file.name}</span>
            </span>
          </div>
        </FileMenu>
        {newFileType && <TreeInputItem file={{ ...file, ty: newFileType }} onComplete={createFile} onDismiss={disableNewFile} />}
      </>
    );
  } else {
    return <div className="flex items-center space-x-2 cursor-pointer bg-gray-300">
      <TreeInputItem file={file} onComplete={renameFile} onDismiss={disableRenameFile} />
    </div>
  }
};

const TreeFolderItem = ({ file, onSelect, path = '/', level }: Props) => {
  const { open: globalOpen, setOpen: setGlobalOpen } = useFileTree();
  const [open, setOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const { data, isLoading } = useListFiles({ path, enabled: open })

  const [newFileType, setNewFileType] = useState<FsFileType | undefined>(undefined);
  const { mutateAsync: renameFileOp } = useRenameFile(file)
  const { mutateAsync: createFileOp } = useCreateFile(file, true)

  const enableRenameFile = () => setIsEditing(true)
  const disableRenameFile = () => setIsEditing(false)
  const enableNewFile = (ty: FsFileType) => {
    setOpen(true)
    setNewFileType(ty)
  }
  const disableNewFile = () => setNewFileType(undefined)

  const createFile = useCallback((path: string) => {
    if (newFileType) {
      createFileOp({ body: { path, ty: newFileType } })
      disableNewFile()
    }
  }, [newFileType])

  const renameFile = useCallback((newPath: string) => {
    renameFileOp({ body: { from: file.path, to: newPath } })
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
          <div onClick={click} style={{ paddingLeft: `12px` }} >
            <div className="flex flex-row items-center space-x-2 cursor-pointer hover:bg-gray-300">
              {isLoading ? <Spinner /> : isOpen ? <FaFolderOpen /> : <FaFolder />}
              <span>{file?.name}</span>
            </div>
            {files?.map(file => <TreeItem key={file.path} file={file} level={level + 1} onSelect={onSelect} />)}
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

  console.log(file)

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
    console.log(state, state === file.name)
    if (!state.trim() || state === file.name) {
      onDismiss();
      return;
    }

    console.log(getPath())
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
      style={{ paddingLeft: !indent ? '12px' : '24px' }}
    >
      {file.ty === FsFileType.FILE ? <FaFile /> : <FaFolder />}

      <form onSubmit={submit}>
        <input
          ref={ref}
          value={state}
          onChange={(e) => setState(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          className="w-full text-white border-gray-800 bg-gray-500"
        />
      </form>
    </div>
  );
};