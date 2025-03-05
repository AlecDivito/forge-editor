"use client";

import { IGridviewPanelProps } from "dockview";
import { FC } from "react";
import { useKeyboard } from "react-pre-hooks";

interface Props {
  name?: string;
}

const Chat: FC<IGridviewPanelProps<Props>> = (props) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const toggle = (e: any) => {
    e.preventDefault();
    e.stopPropagation();
    props.api.setVisible(!props.api.isVisible);
  };

  useKeyboard({
    keys: {
      "ctrl+r": toggle,
      "meta+shift+r": toggle,
      "meta+shift+i": toggle,
    },
  });

  return <div>Hello world</div>;
};

export default Chat;
