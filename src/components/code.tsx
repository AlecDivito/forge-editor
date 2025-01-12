"use client";

import FileViewerController from "@/components/filesystem";

// import dynamic from "next/dynamic";
import ResizableComponent from "./interaction/resizable";
import { useWebSocket } from "next-ws/client";
import { useEffect } from "react";
import { Message } from "@/interfaces/socket";
import { useFileStore } from "@/store";

// const DynamicTerminal = dynamic(() => import("@/components/terminal"), {
//   ssr: false,
// });

const VSCodeLayout = () => {
  const ws = useWebSocket();
  const handleMessage = useFileStore((state) => state.handleMessage);

  useEffect(() => {
    async function onMessage(event: MessageEvent) {
      const message = JSON.parse(event.data) as Message;
      handleMessage(message);
    }

    ws?.addEventListener("message", onMessage);
    return () => ws?.removeEventListener("message", onMessage);
  }, [ws, handleMessage]);

  // const [fileViewerWidth, setFileViewerWidth] = useState(300);
  // const [editorHeight, setEditorHeight] = useState(300);
  // const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  // const [activeFile, setActiveFile] = useState<OpenFile | null>(null);

  // useEffect(() => {
  //   const socket = new WebSocket("ws://localhost:3000/api/socket");

  //   socket.onmessage = (event) => {
  //     const { type, filePath, content } = JSON.parse(event.data);
  //     if (type === "updateFile") {
  //       useStore.getState().applyServerUpdate(filePath, content);
  //     }
  //   };

  //   return () => {
  //     socket.close();
  //   };
  // }, []);

  // const handleResize = (side: ResizableSides, size: number) => {
  //   if (side === "right") {
  //     setFileViewerWidth(size);
  //   } else if (side === "bottom") {
  //     setEditorHeight(size);
  //   }
  // };

  // const handleSelectFile = async (path: string) => {
  //   try {
  //     // Check if the file is already open
  //     const existingFile = openFiles.find((file) => file.path === path);
  //     if (existingFile) {
  //       setActiveFile(existingFile);
  //       return;
  //     }

  //     // Fetch file content from API
  //     const response = await fetch(
  //       `/api/fs/file?path=${encodeURIComponent(path)}`
  //     );
  //     const data = await response.json();

  //     if (response.ok && data.success) {
  //       const newFile = { path, content: data.content };
  //       setOpenFiles((prev) => [...prev, newFile]);
  //       setActiveFile(newFile);
  //     } else {
  //       console.error("Failed to fetch file:", data.message);
  //     }
  //   } catch (error) {
  //     console.error("Error fetching file:", error);
  //   }
  // };

  // const tabs = openFiles.map((file) => ({
  //   id: file.path,
  //   label: file.path.split("/").pop() || "Untitled",
  //   content: <span>{file.path}</span>,
  // }));

  return (
    <div className="flex h-screen">
      <ResizableComponent
        resizableSides={{ right: true }}
        className="flex-shrink-0"
        // onResize={(size) => handleResize("right", size)}
      >
        <FileViewerController />
      </ResizableComponent>
      {/* <div className="flex flex-col flex-1">
        <div className="flex-grow border border-red-500">
          <TabsContainer
            tabs={tabs}
            onTabChange={(id) => {
              const handle = openFiles.find(({ path }) => path === id);
              if (handle) {
                setActiveFile(handle);
              }
            }}
            onTabClose={(id) =>
              setOpenFiles(openFiles.filter(({ path }) => path !== id))
            }
          />
          <Editor file={activeFile} />
        </div>
        <ResizableComponent
          resizableSides={{ top: true }}
          className="flex-shrink-0"
          onResize={(size) => handleResize("bottom", size)}
        >
          <DynamicTerminal />
        </ResizableComponent>
      </div> */}
    </div>
  );
};

export default VSCodeLayout;
