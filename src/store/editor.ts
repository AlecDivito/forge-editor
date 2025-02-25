import { ServerLspNotification } from "@/service/lsp";
import { TextDocumentItem } from "vscode-languageserver-protocol";
import { create } from "zustand";

export interface EditorState {
  activeFiles: Record<string, TextDocumentItem | null>;

  handleNotification: (message: ServerLspNotification) => void;

  openFile: (file: string) => void;
  closeFile: (file: string) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  activeFiles: {},

  handleNotification: (message: ServerLspNotification) => {
    if (message.method === "proxy/filesystem/created") {
      return set((state) => {
        const path = message.params.uri.replace("file:///", "");
        const item = { uri: path, languageId: "", version: 0, text: "" };
        return { activeFiles: { ...state.activeFiles, [path]: item } };
      });
    }
    if (message.method === "proxy/filesystem/open") {
      const path = message.params.textDocument.uri.replace("file:///", "");
      message.params.textDocument.uri = path;
      set((state) => {
        if (state.activeFiles?.[path] !== null) {
          return {};
        }
        return {
          activeFiles: { ...state.activeFiles, [path]: message.params.textDocument },
        };
      });
    } else if (message.method === "proxy/filesystem/close") {
      const path = message.params.textDocument.uri.replace("file:///", "");
      set((state) => {
        const updatedFiles = { ...state.activeFiles };
        delete updatedFiles[path];
        return { activeFiles: updatedFiles };
      });
    }
  },

  openFile: (file: string) =>
    set((state) => ({
      activeFiles: { ...state.activeFiles, [file]: null },
    })),

  closeFile: (file: string) => {
    return set((state) => {
      const activeFiles = { ...state.activeFiles };
      if (file in activeFiles) {
        delete activeFiles[file];
      }
      return { activeFiles };
    });
  },
}));
