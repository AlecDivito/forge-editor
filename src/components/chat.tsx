"use client";

import { IGridviewPanelProps } from "dockview";
import { FC } from "react";

interface Props {
  name?: string;
}

const Chat: FC<IGridviewPanelProps<Props>> = () => {
  return <div>Hello world</div>;
};

export default Chat;
