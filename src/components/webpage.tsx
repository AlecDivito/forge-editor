"use client";

import { useFileStore } from "@/store";
import { useEffect } from "react";
import VSCodeLayout from "./code";
import { WebSocketProvider } from "./websocketContext";

export default function WebPageInitializer({ tree }: { tree: string[] }) {
  const setTree = useFileStore((state) => state.initializeTree);

  useEffect(() => {
    setTree(tree); // Initialize Zustand store with server data
  }, [tree, setTree]);

  return (
    <WebSocketProvider>
      <VSCodeLayout />
    </WebSocketProvider>
  );
}
