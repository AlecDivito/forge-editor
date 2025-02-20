"use client";

import { IGridviewPanelProps } from "dockview";
import { FC } from "react";
import { useXTerm } from "react-xtermjs";

interface TerminalParams {
  name: string;
}

const Terminal: FC<IGridviewPanelProps<TerminalParams>> = () => {
  const { instance, ref } = useXTerm();
  instance?.writeln("Hello from react-xtermjs!");
  instance?.onData((data) => instance?.write(data));

  return <div ref={ref} style={{ width: "100%", height: "100%" }} />;
};

export default Terminal;
