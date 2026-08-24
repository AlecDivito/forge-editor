import { createContext, useContext, useState } from "react";

type FileTreeContextType = {
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
};

type Props = {
  open?: boolean;
  children: React.ReactNode;
};

export const FileTreeContext = createContext<FileTreeContextType | undefined>(
  undefined
);

export function FileTreeProvider({ open: initialOpen = true, children }: Props) {
  const [open, setOpen] = useState(initialOpen);

  return (
    <FileTreeContext.Provider value={{ open, setOpen }}>
      {children}
    </FileTreeContext.Provider>
  );
}

export function useFileTree() {
  const context = useContext(FileTreeContext);

  if (!context) {
    throw new Error("useFileTree must be used within a FileTreeProvider");
  }

  return context;
}