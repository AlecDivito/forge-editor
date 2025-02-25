import { ServerLspNotification } from "@/service/lsp";
import { Diagnostic } from "vscode-languageserver-protocol";
import { create } from "zustand";

export interface Notification {
  createdAt: Date;
  message: ServerLspNotification;
}

export interface NotificationState {
  notifications: Notification[];
  diagnostics: { [key: string]: Diagnostic[] };

  handleNotification: (message: ServerLspNotification) => void;
}

export const useNotification = create<NotificationState>((set) => ({
  notifications: [],
  diagnostics: {},

  handleNotification: (message: ServerLspNotification) => {
    return set((state) => ({
      notifications: ["window/logMessage", "$/logTrace"].includes(message.method)
        ? [...state.notifications, { createdAt: new Date(Date.now()), message }]
        : state.notifications,
      diagnostics:
        "textDocument/publishDiagnostics" === message.method
          ? { ...state.diagnostics, [message.params.uri.replace("file:///", "")]: message.params.diagnostics }
          : state.diagnostics,
    }));
  },
}));
