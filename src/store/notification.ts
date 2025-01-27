import { ServerLspNotification } from "@/service/lsp";
import { create } from "zustand";

export interface Notification {
  createdAt: Date;
  message: ServerLspNotification;
}

export interface NotificationState {
  notifications: Notification[];

  pushNotification: (message: ServerLspNotification) => void;
}

export const useNotification = create<NotificationState>((set) => ({
  notifications: [],

  pushNotification: (message: ServerLspNotification) =>
    set((state) => ({
      notifications: ["window/logMessage", "$/logTrace"].includes(message.method)
        ? [...state.notifications, { createdAt: new Date(Date.now()), message }]
        : state.notifications,
    })),
}));
