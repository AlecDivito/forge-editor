"use client";

import { IGridviewPanelProps } from "dockview";
import { FC } from "react";
import { useKeyboard } from "react-pre-hooks";

interface Props {
  name?: string;
}

const Chat: FC<IGridviewPanelProps<Props>> = (props) => {
  useKeyboard({
    keys: {
      "ctrl+r": (e) => {
        e.preventDefault();
        e.stopPropagation();
        props.api.setVisible(!props.api.isVisible);
      },
      "meta+shift+r": (e) => {
        e.preventDefault();
        e.stopPropagation();
        props.api.setVisible(!props.api.isVisible);
      },
    },
  });

  return <div>Hello world</div>;
};

export default Chat;
