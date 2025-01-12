"use client";

import { useFileStore } from "@/store";
import { useEffect } from "react";
import VSCodeLayout from "./code";
// import { WebSocketProvider } from "./websocketContext";
import { WebSocketProvider } from "next-ws/client";

export default function WebPageInitializer({ tree }: { tree: string[] }) {
  const setTree = useFileStore((state) => state.initializeTree);

  useEffect(() => {
    setTree(tree); // Initialize Zustand store with server data
  }, [tree, setTree]);

  return (
    <WebSocketProvider url="ws://localhost:3000/api/socket">
      <VSCodeLayout />
    </WebSocketProvider>
  );
}
