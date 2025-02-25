"use client";

import React, { FC, useEffect, useRef, useState } from "react";
import { IGridviewPanelProps } from "dockview";
import { useKeyboard } from "react-pre-hooks";
import dynamic from "next/dynamic";

interface TerminalParams {
  name: string;
}

const XTerm = dynamic(() => import("./xterm"), { ssr: true });

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
  const [addons, setAddons] = useState([]);

  useEffect(() => {
    if (websocket) {
      const f = async () => {
        const AttachAddon = (await import("./attach")).default;
        // const WebLinksAddon = await import("@xterm/addon-web-links");
        setAddons([AttachAddon(websocket)]);
      };
      f();
    }
  }, [websocket]);

  if (addons.length === 0) {
    return null;
  }
  return <XTerm addons={addons} />;
};

export default Terminal;
