import { EditorView, highlightActiveLineGutter, lineNumbers } from "@codemirror/view";

/** The source-owned line-number gutter; debugger gutters are registered beside it. */
export const lineNumberExtension = [
  lineNumbers(),
  highlightActiveLineGutter(),
  EditorView.baseTheme({
    ".cm-lineNumbers .cm-gutterElement": { minWidth: "2.5rem", textAlign: "right" },
  }),
];
