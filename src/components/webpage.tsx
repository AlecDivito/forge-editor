"use client";

import { useFileStore } from "@/store/filetree";
import { useEffect } from "react";
import VSCodeLayout from "./code";
import { WebSocketProvider } from "next-ws/client";
import "dockview/dist/styles/dockview.css";
import { DirectoryEntry } from "@/lib/storage";

interface Props {
  folder: DirectoryEntry[];
  project: string;
  user: string;
}

export default function WebPageInitializer({ user, folder, project }: Props) {
  const setFolderStructure = useFileStore((state) => state.initialize);

  useEffect(() => {
    setFolderStructure(user, project, folder); // Initialize Zustand store with server data
  }, [user, project, folder, setFolderStructure]);

  // We want to determine that the project is created or not. We would want to
  // store all of the git information on the client side so that we can show it
  // to the user.

  return (
    <WebSocketProvider url="ws://localhost:3000/api/lsp">
      <VSCodeLayout />
    </WebSocketProvider>
  );
}
