import { ServerLspNotification } from "@/service/lsp";
import { InitializeResult } from "vscode-languageserver-protocol";
import { create } from "zustand";

export interface LspState {
  capabilities: Partial<Record<string, InitializeResult>>;

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
