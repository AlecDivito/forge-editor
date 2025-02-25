import { ServerLspNotification } from "@/service/lsp";
import { FileExtension } from "@/service/lsp/proxy";
import { InitializeResult } from "vscode-languageserver-protocol";
import { create } from "zustand";

export interface LspState {
  capabilities: Partial<Record<FileExtension, InitializeResult>>;

  handleNotification: (message: ServerLspNotification) => void;
}

export const useLspStore = create<LspState>((set) => ({
  capabilities: {},

  handleNotification: (message: ServerLspNotification) => {
    if (message.method === "proxy/initialize") {
      set((state) => ({
        capabilities: {
          ...state.capabilities,
          [message.language]: message.params,
        },
      }));
    }
  },
}));
