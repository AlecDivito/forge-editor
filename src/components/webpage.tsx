"use client";

import { useFileStore } from "@/store/filetree";
import { useEffect } from "react";
import VSCodeLayout from "./code";
import { WebSocketProvider } from "next-ws/client";
import "dockview/dist/styles/dockview.css";
import { Folder } from "@/service/fs";

export default function WebPageInitializer({ folder, project }: { folder: Folder; project: string }) {
  const setFolderStructure = useFileStore((state) => state.initialize);

  useEffect(() => {
    setFolderStructure(project, folder); // Initialize Zustand store with server data
  }, [project, folder, setFolderStructure]);

  return (
    <WebSocketProvider url="ws://localhost:3000/api/lsp">
      <VSCodeLayout />
    </WebSocketProvider>
  );
}
