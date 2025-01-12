"use client";

import { useXTerm } from "react-xtermjs";

const Terminal = () => {
  const { instance, ref } = useXTerm();
  instance?.writeln("Hello from react-xtermjs!");
  instance?.onData((data) => instance?.write(data));

  return <div ref={ref} style={{ width: "100%", height: "100%" }} />;
};

export default Terminal;
