"use client";

import { useFileStore } from "@/store/filetree";
import { FC } from "react";
import FsTreeAccordionItem from "./fileTree/Tree";
import { IGridviewPanelProps } from "dockview-react";
import { useKeyboard } from "react-pre-hooks";
import { useEditorStore } from "@/store/editor";
import { FaFile, FaSearch } from "react-icons/fa";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "./ui/accordion";
import { Button } from "./ui/button";
import { Edit2, FilePlus2, FolderPlus, RefreshCcw, SquareMinusIcon, Trash2 } from "lucide-react";
import { FileTreeProvider } from "./fileTree/providers/FileTreeProvider";

type Props = Record<string, string>;

const FileViewerController: FC<IGridviewPanelProps<Props>> = (props) => {
  const { fileTree } = useFileStore();
  // const { openFile } = useEditorStore();

  useKeyboard({
    keys: {
      "meta+b": () => props.api.setVisible(!props.api.isVisible),
    },
  });



  return (
    <div className="h-full flex">
      <div className="h-full w-12.5 bg-gray-300 border-red-500">
        <div className="bg-gray-500 h-12.5 w-12.5 flex justify-center items-center">
          <FaFile className="cursor-pointer" size={20} title="Create File" />
        </div>
        <div className="bg-gray-500 h-12.5 w-12.5 flex justify-center items-center">
          <FaSearch className="cursor-pointer" size={20} title="Search files" />
        </div>
      </div>
      <Accordion type="multiple" defaultValue={["file-system"]} className="w-full">
        <FileTreeProvider>
          <FsTreeAccordionItem />
        </FileTreeProvider>
        <AccordionItem value="outline">
          <AccordionTrigger header="Outline"></AccordionTrigger>
          <AccordionContent>hi</AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
};

export default FileViewerController;
