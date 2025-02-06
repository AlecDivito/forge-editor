import { EditorView } from "@uiw/react-codemirror";
import { DocumentUri, Capabilities, LspClient } from ".";
import { formatContents } from "./htmlFormatter";

export const requestHoverToolTip = async (view: EditorView, pos: number /* side:  -1 | 1 */) => {
  const uri = view.state.facet(DocumentUri);
  const capabilities = view.state.facet(Capabilities);
  const sender = view.state.facet(LspClient);

  if (!capabilities.capabilities?.hoverProvider) {
    return null;
  }

  const line = view.state.doc.lineAt(pos);

  // console.log(pos);

  // TODO: (Alec) Send document changes
  const result = await sender.hover({
    textDocument: { uri },
    position: {
      line: line.number - 1,
      character: pos - line.from,
    },
  });

  // console.log("here", result);

  if (result.method !== "textDocument/hover") {
    return null;
  }

  if (!result.result) {
    return null;
  }

  const { contents, range } = result.result;

  let end = undefined;
  // let position = pos;
  // Offset if range exists
  if (range) {
    // Maybe we can highlight what we are doing.
    // if (range.start.line === 0) {
    //   position = range.start.character;
    // } else {
    //   position = view.state.doc.line(range.start.line).from + range.start.character;
    // }

    if (range.end.line === 0) {
      end = range.end.character;
    } else {
      end = view.state.doc.line(range.end.line).from + range.end.character;
    }
  }

  const dom = document.createElement("div");
  dom.innerHTML = await formatContents(contents);

  return {
    pos: pos,
    end,
    create: () => {
      return { dom };
    },
    above: true,
    active: true,
    arrow: true,
    resize: false,
    clip: false,
  };
};
