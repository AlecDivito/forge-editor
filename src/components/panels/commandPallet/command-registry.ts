import { openSearchPanel } from "@codemirror/search";
import { getActiveDocument, getActiveEditor } from "../code/state/active-editor";
import { saveAllOpenDocuments, saveDocument } from "@/lib/documents/save";

export interface EditorCommand {
  id: string;
  title: string;
  category: string;
  keybinding?: string;
  availability: () => { enabled: boolean; reason?: string };
  run: () => void | Promise<void>;
}

const activeEditor = () => getActiveEditor()
  ? { enabled: true }
  : { enabled: false, reason: "No active code editor" };

export const editorCommands: EditorCommand[] = [
  {
    id: "file.save", title: "Save File", category: "File", keybinding: "Mod+S",
    availability: () => getActiveDocument() ? { enabled: true } : { enabled: false, reason: "No active file" },
    run: async () => { const doc = getActiveDocument(); if (!doc) throw new Error("No active file"); await saveDocument(doc.workspace, doc.fileId); },
  },
  {
    id: "file.saveAll", title: "Save All Files", category: "File",
    availability: () => ({ enabled: true }),
    run: async () => { const result = await saveAllOpenDocuments(); if (result.failures.length) throw new Error(`${result.failures.length} document(s) failed to save`); },
  },
  {
    id: "editor.find", title: "Find in File", category: "Editor", keybinding: "Mod+F",
    availability: activeEditor,
    run: () => { const view = getActiveEditor(); if (!view) throw new Error("No active code editor"); openSearchPanel(view); view.focus(); },
  },
  ...([ ["editor.goToLine", "Go to Line", ":"], ["lsp.documentSymbols", "Go to Symbol in File", "@"], ["lsp.workspaceSymbols", "Go to Symbol in Workspace", "#"] ] as const).map(([id, title, prefix]) => ({
    id, title, category: "Navigation", availability: activeEditor,
    run: () => { window.dispatchEvent(new CustomEvent("forge:open-command-palette", { detail: prefix })); },
  })),
];
