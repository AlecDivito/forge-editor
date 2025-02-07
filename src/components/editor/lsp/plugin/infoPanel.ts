import { diagnosticCount } from "@codemirror/lint";
import { showPanel, EditorView, Panel } from "@codemirror/view";
import { language } from "@codemirror/language";
import { themeConfig, themeSettingsField } from "./theme";

function diagnosticCountLabel(view: EditorView): string {
  const count = diagnosticCount(view.state);
  if (count === 0) {
    return `✅`;
  } else {
    return `🤷 ${count}`;
  }
}

const getCursorLabel = (view: EditorView) => {
  const position = view.state.selection.main.head;
  const line = view.state.doc.lineAt(position);
  const column = position - line.from;
  return `${line.number}:${column}`;
};

const getSelectionLabel = (view: EditorView) => {
  const linesSelected = new Set<number>();
  let charactersSelected = 0;
  for (const range of view.state.selection.ranges) {
    const { from, to } = range;
    if (from === to) continue; // Ignore cursor-only selections

    const fromLine = view.state.doc.lineAt(from);
    const toLine = view.state.doc.lineAt(to);

    // Count lines (store unique line numbers)
    for (let i = fromLine.number; i <= toLine.number; i++) {
      linesSelected.add(i);
    }

    // Count characters
    charactersSelected += to - from;
  }

  if (charactersSelected == 0) {
    return "";
  } else if (linesSelected.size <= 1) {
    return `(${charactersSelected} characters)`;
  } else {
    return `(${linesSelected.size} lines, ${charactersSelected} characters)`;
  }
};

function wordCountPanel(view: EditorView): Panel {
  const theme = view.state.field(themeSettingsField);

  const parent = document.createElement("div");
  parent.setAttribute(
    "style",
    `display: flex; justify-content: space-between; padding: 8px; border-top: 1px solid #ddd; color: ${theme.gutterActiveForeground}; background-color: ${theme.foreground}; font-family: Arial, sans-serif; font-size: 14px;`,
  );

  // Left Section: Error Count
  const left = document.createElement("div");
  const errorCount = document.createElement("span");
  errorCount.textContent = diagnosticCountLabel(view);
  left.appendChild(errorCount);

  // Right Section
  const right = document.createElement("div");
  right.setAttribute("style", "display: flex; gap: 12px;");

  // Cursor Position (line:col)
  const cursorLabel = document.createElement("span");
  cursorLabel.textContent = getCursorLabel(view);

  // Selection Details (lines, characters)
  const selectionLabel = document.createElement("span");
  selectionLabel.textContent = getSelectionLabel(view);

  // Programming Language Label
  const languageLabel = document.createElement("span");
  languageLabel.textContent = view.state.facet(language)?.name ?? "text";

  // Append elements to right section
  right.appendChild(cursorLabel);
  right.appendChild(selectionLabel);
  right.appendChild(languageLabel);

  // Append left and right sections
  parent.appendChild(left);
  parent.appendChild(right);

  return {
    dom: parent,
    update(update) {
      if (update.docChanged || update.selectionSet) {
        errorCount.textContent = diagnosticCountLabel(view);
        cursorLabel.textContent = getCursorLabel(view);
        selectionLabel.textContent = getSelectionLabel(view);
        languageLabel.textContent = update.state.facet(language)?.name ?? "text";
      }
    },
  };
}

export function infoPanelExtension() {
  return showPanel.of(wordCountPanel);
}
