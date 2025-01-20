import { Popover } from "react-tiny-popover";
import Markdown from "react-markdown";
import { FC } from "react";

interface Props {
  ref: HTMLDivElement;
  content: string;
}

const EditorToolTip: FC<Props> = ({ ref, content }) => {
  return (
    <Popover
      isOpen={true}
      positions={["top", "bottom", "left", "right"]} // preferred positions by priority
      content={<Markdown>{content as string}</Markdown>}
    >
      {ref}
    </Popover>
  );
};

export default EditorToolTip;
