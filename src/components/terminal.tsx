"use client";

import React, { FC, useEffect, useMemo, useRef } from "react";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { AttachAddon } from "@xterm/addon-attach";
import { IGridviewPanelProps } from "dockview";
import { useKeyboard } from "react-pre-hooks";
import dynamic from "next/dynamic";

interface TerminalParams {
  name: string;
}

const XTerm = dynamic(() => import("./xterm"), { ssr: false });

const useTerminalWebsocet = (url: string) => {
  const clientRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (clientRef.current) {
      clientRef.current.close();
      clientRef.current = null;
    }

    const client = new WebSocket(url);
    clientRef.current = client;

    return () => {
      console.log("closing");
      client.close();
      clientRef.current = null;
    };
  }, [url]);

  return clientRef.current;
};

const Terminal: FC<IGridviewPanelProps<TerminalParams>> = (props) => {
  useKeyboard({
    keys: {
      "meta+j": () => props.api.setVisible(false),
      "ctrl+`": () => props.api.setVisible(true),
    },
  });
  const websocket = useTerminalWebsocet("http://localhost:3000/api/terminal");
  const addons = useMemo(() => {
    if (websocket && websocket.OPEN) {
      return [new WebLinksAddon(), new AttachAddon(websocket)];
    } else {
      return [];
    }
  }, [websocket]);

  if (addons.length === 0) {
    return null;
  }
  return <XTerm addons={addons} />;
};

export default Terminal;
