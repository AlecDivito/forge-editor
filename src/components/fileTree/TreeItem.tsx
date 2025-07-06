import { FileNode } from "@/utils/filetree";
import { FaFile, FaFolder, FaFolderOpen } from "react-icons/fa";
import FileMenu from "./FileMenu";
import { FormEventHandler, useCallback, useEffect, useRef, useState } from "react";
import { useCommandQueue } from "@/store/commands";
import FsTree from "./Tree";
import { cn } from "@/lib/utils";

interface Props {
  node: FileNode;
  level: number;
  onSelect?: (fileName: string) => void;
}

const TreeFileItem = ({ node, onSelect }: Props) => {
  return (
    <FileMenu node={node}>
      <div onClick={() => onSelect?.(node.path)} className=" space-x-2 cursor-pointer">
        <span className="flex items-center space-x-2 cursor-pointer">
          <FaFile />
          <span>{node.name}</span>
        </span>
      </div>
    </FileMenu>
  );
};

export const TreeFolderItem = ({ node, onSelect, level }: Props) => {
  const [open, setOpen] = useState(false);
  const { push } = useCommandQueue();

  return (
    <FileMenu node={node}>
      <div onClick={() => setOpen(!open)} style={{ paddingLeft: `${level + 4}px` }}>
        <span className="flex items-center space-x-2 cursor-pointer">
          {open ? <FaFolderOpen /> : <FaFolder />}
          <span>{node.name}</span>
        </span>
        {(node?.children || []).map((node) => (
          <FileItem key={node.id} node={node} level={level} onSelect={onSelect} />
        ))}
      </div>
    </FileMenu>
  );
};

const TreeInputItem = ({ node }: Props) => {
  const { push } = useCommandQueue();
  const [state, setState] = useState("");
  const ref = useRef<null | HTMLInputElement>(null);

  useEffect(() => {
    if (ref && ref.current) {
      ref.current.click();
      ref.current.focus();
    }
  }, [ref]);

  useEffect(() => {
    const callback = (e: MouseEvent) => {
      const rect = ref.current?.getBoundingClientRect() || {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      };
      if (
        !(
          e.clientX > rect?.x &&
          e.clientX < rect?.x + rect?.width &&
          e.clientY > rect?.y &&
          e.clientY < rect?.y + rect?.height
        )
      ) {
        const type = node.type === "createFile" ? "file.new.hide" : "folder.new.hide";
        push({ type, path: node.path });
      }
    };
    document.addEventListener("click", callback);
    return () => {
      document.removeEventListener("click", callback);
    };
  }, [node, push]);

  const submit: FormEventHandler<HTMLFormElement> = useCallback(
    (e) => {
      e.preventDefault();
      const createType = node.type === "createFile" ? "file.create" : "folder.create";
      push({ type: createType, path: `${node.path}/${state}` });
      const hideType = node.type === "createFile" ? "file.new.hide" : "folder.new.hide";
      push({ type: hideType, path: node.path });
    },
    [push, node, state],
  );

  return (
    <div className="flex gap-2">
      {node.type === "createFile" ? <FaFile /> : <FaFolder />}
      <form onSubmit={submit}>
        <input
          value={state}
          onChange={(e) => setState(e.target.value)}
          ref={ref}
          className="w-full border-gray-800 bg-gray-500"
        />
      </form>
    </div>
  );
};

export function FileItem({ node, onSelect, level }: Props) {
  switch (node.type) {
    case "f":
      return <TreeFileItem level={level} node={node} onSelect={onSelect} />;
    case "d":
      return <TreeFolderItem level={level} node={node} onSelect={onSelect} />;
    case "createFile":
    case "createFolder":
      return <TreeInputItem level={level} node={node} />;
  }
}
