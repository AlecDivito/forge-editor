import { EditorView } from "@uiw/react-codemirror";
import { DocumentUri, Capabilities, LspClient } from ".";

export const requestHoverToolTip = (
  view: EditorView,
  pos: number /* side:  -1 | 1 */
) => {
  const uri = view.state.facet(DocumentUri);
  const capabilities = view.state.facet(Capabilities);
  const sender = view.state.facet(LspClient);

  if (!capabilities.capabilities?.hoverProvider) {
    return null;
  }

  const line = view.state.doc.lineAt(pos);

  // TODO: (Alec) Send document changes

  const result = sender.hover({
    textDocument: { uri },
    position: {
      line: line.number,
      character: pos - line.from,
    },
  });

  console.log(result);

  return null;
};
