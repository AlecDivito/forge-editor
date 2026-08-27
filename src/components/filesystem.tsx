"use client";

import { useFileStore } from "@/store/filetree";
import { FC, ReactNode, useState } from "react";
import FsTreeAccordionItem from "./fileTree/Tree";
import { IGridviewPanelProps } from "dockview-react";
import { useKeyboard } from "react-pre-hooks";
import { FaFile, FaSearch } from "react-icons/fa";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "./ui/accordion";
import { FileTreeProvider } from "./fileTree/providers/FileTreeProvider";
import FileSearchView from "./fileSearch/SearchView";

type Props = Record<string, string>;

type ViewType = 'file' | 'search'

const FileViewerController: FC<IGridviewPanelProps<Props>> = (props) => {
  const { fileTree } = useFileStore();
  const [view, setView] = useState<ViewType>('file')

  useKeyboard({
    keys: {
      "meta+b": () => props.api.setVisible(!props.api.isVisible),
    },
  });

  const viewComponent: Record<ViewType, ReactNode> = {
    'file': (
      <Accordion type="multiple" defaultValue={["file-system"]} className="w-full">
        <FileTreeProvider>
          <FsTreeAccordionItem />
        </FileTreeProvider>
        <AccordionItem value="outline">
          <AccordionTrigger header="Outline"></AccordionTrigger>
          <AccordionContent>hi</AccordionContent>
        </AccordionItem>
      </Accordion>
    ),
    'search': (
      <FileTreeProvider>
        <FileSearchView />
      </FileTreeProvider>
    )
  }

  return (
    <div className="h-full flex">
      <div className="h-full w-12.5 bg-gray-300 border-red-500">
        <div className="bg-gray-500 h-12.5 w-12.5 flex justify-center items-center">
          <FaFile onClick={() => setView('file')} className="cursor-pointer" size={20} title="Create File" />
        </div>
        <div className="bg-gray-500 h-12.5 w-12.5 flex justify-center items-center">
          <FaSearch onClick={() => setView('search')} className="cursor-pointer" size={20} title="Search files" />
        </div>
      </div>
      {viewComponent[view]}
    </div>
  );
};

export default FileViewerController;
