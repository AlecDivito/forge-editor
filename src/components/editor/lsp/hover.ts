import { EditorView } from "@uiw/react-codemirror";
import { DocumentUri, Capabilities, LspClient } from ".";
import { MarkedString, MarkupContent } from "vscode-languageserver-protocol";
// import { Marked } from "marked";
// import { markedHighlight } from "marked-highlight";
import * as marked from "marked";

// const a = []

// // This is a comment explaining b
// const b = ""

// const c = {}

// // This is a comment about A. I like A
// class A {

// }

// console.log("Test")

// a.join()

// console.log(" A lit stupid ")

// const marked = new Marked(
//   markedHighlight({
// 	emptyLangClass: 'hljs',
//     langPrefix: 'hljs language-',
//     highlight(code, lang, info) {
//       const language = hljs.getLanguage(lang) ? lang : 'plaintext';
//       return hljs.highlight(code, { language }).value;
//     }
//   })
// );

async function formatContents(contents: MarkupContent | MarkedString | MarkedString[]): Promise<string> {
  let content = "";
  if (Array.isArray(contents)) {
    const items = [];
    for (const item of contents) {
      items.push((await formatContents(item)) + "\n\n");
    }
    content = items.join("");
  } else if (typeof contents === "string") {
    content = contents;
  } else {
    content = contents.value;
  }

  // TODO: Sanitize the output of the markdown
  const htmlString = marked.parse(content);

  return htmlString;
}

export const requestHoverToolTip = async (view: EditorView, pos: number /* side:  -1 | 1 */) => {
  const uri = view.state.facet(DocumentUri);
  const capabilities = view.state.facet(Capabilities);
  const sender = view.state.facet(LspClient);

  if (!capabilities.capabilities?.hoverProvider) {
    return null;
  }

  const line = view.state.doc.lineAt(pos);

  console.log(pos);

  // TODO: (Alec) Send document changes
  const result = await sender.hover({
    textDocument: { uri },
    position: {
      line: line.number - 1,
      character: pos - line.from,
    },
  });

  console.log("here", result);

  if (result.method !== "textDocument/hover") {
    return null;
  }

  if (!result.result) {
    return null;
  }

  const { contents, range } = result.result;

  let end = undefined;
  let position = pos;
  // Offset if range exists
  if (range) {
    // Maybe we can highlight what we are doing.
    if (range.start.line === 0) {
      position = range.start.character;
    } else {
      position = view.state.doc.line(range.start.line).from + range.start.character;
    }

    if (range.end.line === 0) {
      end = range.end.character;
    } else {
      end = view.state.doc.line(range.end.line).from + range.end.character;
    }
  }

  const dom = document.createElement("div");
  dom.classList.add("documentation");
  dom.innerHTML = await formatContents(contents);

  console.log(position, end);

  return { pos: position, end, create: () => ({ dom }), above: true };
};
