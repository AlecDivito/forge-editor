import { closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, defaultHighlightStyle, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { EditorState, Extension } from "@codemirror/state";
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightSpecialChars,
  keymap,
  rectangularSelection,
  EditorView,
} from "@codemirror/view";
import { lintKeymap } from "@codemirror/lint";
import { searchKeymap } from "@codemirror/search";

/**
 * The editor chrome is intentionally assembled here instead of using
 * `basicSetup`. Gutter extensions are deliberately kept in their own files:
 * they have document-level state and evolve with debugger/source-control APIs.
 */
const editorTheme = EditorView.theme({
  "&": {
    backgroundColor: "var(--background)",
    color: "var(--foreground)",
    fontFamily: "var(--font-mono)",
    fontSize: "13px",
  },
  ".cm-content": {
    caretColor: "var(--primary)",
    fontFamily: "inherit",
    lineHeight: "1.65",
    padding: "0.5rem 0",
  },
  ".cm-gutters": {
    backgroundColor: "var(--background)",
    borderRight: "1px solid var(--border)",
    color: "var(--muted-foreground)",
    fontFamily: "inherit",
  },
  ".cm-gutterElement": {
    padding: "0 0.75rem 0 0.5rem",
  },
  ".cm-activeLine": { backgroundColor: "color-mix(in oklch, var(--muted) 55%, transparent)" },
  ".cm-activeLineGutter": { backgroundColor: "color-mix(in oklch, var(--muted) 70%, transparent)" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": {
    backgroundColor: "color-mix(in oklch, var(--primary) 28%, transparent) !important",
  },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--primary)" },
  ".cm-matchingBracket": {
    backgroundColor: "color-mix(in oklch, var(--primary) 18%, transparent)",
    color: "var(--foreground) !important",
    outline: "1px solid color-mix(in oklch, var(--primary) 45%, transparent)",
  },
  ".cm-tooltip-autocomplete": {
    border: "1px solid var(--border)",
    borderRadius: "var(--radius)",
    backgroundColor: "var(--popover)",
    color: "var(--popover-foreground)",
    boxShadow: "var(--shadow-lg)",
  },
  ".cm-tooltip-autocomplete > ul": { fontFamily: "var(--font-sans)" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--accent)",
    color: "var(--accent-foreground)",
  },
});

export const editorExtensions: Extension[] = [
  editorTheme,
  highlightSpecialChars(),
  history(),
  drawSelection(),
  dropCursor(),
  EditorState.allowMultipleSelections.of(true),
  indentOnInput(),
  syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
  bracketMatching(),
  closeBrackets(),
  rectangularSelection(),
  crosshairCursor(),
  highlightActiveLine(),
  keymap.of([
    indentWithTab,
    ...closeBracketsKeymap,
    ...defaultKeymap,
    ...searchKeymap,
    ...historyKeymap,
    ...completionKeymap,
    ...lintKeymap,
  ]),
];
