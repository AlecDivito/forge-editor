"use client";

import { FC, ReactNode, useState } from "react";
import { IGridviewPanelProps } from "dockview-react";
import { useKeyboard } from "react-pre-hooks";
import { FaFile, FaSearch } from "react-icons/fa";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { FileTreeProvider } from "./components/fileTree/providers/FileTreeProvider";
import FsTreeAccordionItem from "./components/fileTree/Tree";
import FileSearchView from "./components/fileSearch/SearchView";
import { selectedWorkspace, useWorkspaceStore } from "@/lib/workspaces";

type Props = Record<string, string>;

type ViewType = 'file' | 'search'

const FileViewerController: FC<IGridviewPanelProps<Props>> = (props) => {
  const [view, setView] = useState<ViewType>('file')
  const workspace = useWorkspaceStore(selectedWorkspace)
  const selectWorkspace = useWorkspaceStore((state) => state.selectWorkspace)
  const workspaces = useWorkspaceStore((state) => state.snapshot?.workspaces ?? [])
  if (!workspace) throw new Error("Explorer requires a selected workspace")

  useKeyboard({
    keys: {
      "meta+b": () => props.api.setVisible(!props.api.isVisible),
    },
  });

  const viewComponent: Record<ViewType, ReactNode> = {
    'file': (
      <Accordion
        type="multiple"
        defaultValue={workspaces.map(({ id }) => `workspace-${id}`)}
        className="w-full h-full bg-background"
      >
        {workspaces.map((item) => (
          <FileTreeProvider key={item.id} workspaceId={item.id}>
            <FsTreeAccordionItem workspaceName={item.name} />
          </FileTreeProvider>
        ))}
        <AccordionItem value="outline">
          <AccordionTrigger header="Outline"></AccordionTrigger>
          <AccordionContent>hi</AccordionContent>
        </AccordionItem>
      </Accordion>
    ),
    'search': (
      <FileTreeProvider workspaceId={workspace.id}>
        <FileSearchView />
      </FileTreeProvider>
    )
  }

  return (
    <div className="h-full flex">

<div className="h-full w-12.5 shrink-0 bg-sidebar">
  {/* File Tab */}
  <div
    onClick={() => setView("file")}
    className={`
      relative flex h-12.5 w-12.5 items-center justify-center
      cursor-pointer transition-colors
      ${view === "file" ? "bg-background" : "bg-sidebar"}
      ${view === "search" ? "rounded-br-2xl" : ""}
    `}
  >
    <FaFile
      size={20}
      title="Create File"
      className={
        view === "file"
          ? "text-sidebar-foreground"
          : "text-sidebar-accent-foreground"
      }
    />

    {view === "file" && (
      <>
        {/* Top-right curve */}
        <div className="pointer-events-none absolute -top-4 right-0 h-4 w-4 bg-sidebar">
          <div className="h-full w-full rounded-br-2xl bg-background" />
        </div>

        {/* Bottom-right curve */}
        <div className="pointer-events-none absolute -bottom-4 right-0 h-4 w-4 bg-sidebar">
          <div className="h-full w-full rounded-tr-2xl bg-background" />
        </div>
      </>
    )}
  </div>

  {/* Search Tab */}
  <div
    onClick={() => setView("search")}
    className={`
      relative flex h-12.5 w-12.5 items-center justify-center
      cursor-pointer transition-colors
      ${view === "search" ? "bg-background" : "bg-sidebar"}
      ${view === "file" ? "rounded-br-2xl" : ""}
    `}
  >
    <FaSearch
      size={20}
      title="Search files"
      className={
        view === "search"
          ? "text-sidebar-foreground"
          : "text-sidebar-accent-foreground"
      }
    />

    {view === "search" && (
      <>
        {/* Top-right curve */}
        <div className="pointer-events-none absolute -top-4 right-0 h-4 w-4 bg-sidebar">
          <div className="h-full w-full rounded-br-2xl bg-background" />
        </div>

        {/* Bottom-right curve */}
        <div className="pointer-events-none absolute -bottom-4 right-0 h-4 w-4 bg-sidebar">
          <div className="h-full w-full rounded-tr-2xl bg-background" />
        </div>
      </>
    )}
  </div>
</div>


      <div className="flex min-w-0 flex-1 flex-col">
        {view === "search" && (
          <select className="m-2 bg-background text-sm" value={workspace.id} onChange={(event) => selectWorkspace(event.target.value as typeof workspace.id)} aria-label="Search workspace">
            {workspaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        )}
        {viewComponent[view]}
      </div>
    </div>
  );
};

export default FileViewerController;
