"use client";

import { useEffect } from "react";
import VSCodeLayout from "./VsCodeLayout";
import { useUICodeState } from "./panels/code/hooks/use-code-ui-state.hook";
import { socket } from "@/lib/ws/connection";
// import 'dockview-react/dist/styles/dockview.css';

interface Props {
}

export default function WebPageInitializer({ }: Props) {
  const setDiagnostics = useUICodeState((s) => s.setDiagnostics)

  useEffect(() => {
    const unsubscribe = socket.subscribe(msg => {
      if (msg.kind === "Diagnostics") {
        setDiagnostics(msg.workspace_id, msg.file_id, msg.diagnostics)
      }
    })
    return () => { unsubscribe(); }
  }, []);

  return (
    <VSCodeLayout />
  );
}
