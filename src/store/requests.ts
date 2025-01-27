import { ID, SuccessfulServerLspResponse } from "@/service/lsp";
import { create } from "zustand";

type RequestPromise<T> = {
  resolve: (message: T) => void;
  reject: (error: Error) => void;
};

type RequestStore = {
  requests: Record<string, RequestPromise<SuccessfulServerLspResponse>>;
  notifications: Record<string, RequestPromise<void>>;

  addNotification: (
    id: ID,
    resolve: Pick<RequestPromise<void>, "resolve">["resolve"],
    reject: Pick<RequestPromise<void>, "reject">["reject"],
  ) => void;
  resolveNotification: (id: ID, message: void) => void;
  rejectNotification: (id: ID, error: Error) => void;
  removeNotification: (id: ID) => void;

  addRequest: (
    id: ID,
    resolve: Pick<RequestPromise<SuccessfulServerLspResponse>, "resolve">["resolve"],
    reject: Pick<RequestPromise<SuccessfulServerLspResponse>, "reject">["reject"],
  ) => void;
  resolveRequest: (id: ID, message: SuccessfulServerLspResponse) => void;
  rejectRequest: (id: ID, error: Error) => void;
  removeRequest: (id: ID) => void;

  clearRequests: (error: Error) => void;
};

export const useRequestStore = create<RequestStore>((set) => ({
  requests: {},
  notifications: {},

  addRequest: (id, resolve, reject) =>
    set((state) => ({
      requests: {
        ...state.requests,
        [id]: { resolve, reject },
      },
    })),
  resolveRequest: (id, message) =>
    set((state) => {
      const request = state.requests[id];
      if (request) {
        request.resolve(message);
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [id]: _, ...remainingRequests } = state.requests;
      return { requests: remainingRequests };
    }),
  rejectRequest: (id, error) =>
    set((state) => {
      const request = state.requests[id];
      if (request) {
        request.reject(error);
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [id]: _, ...remainingRequests } = state.requests;
      return { requests: remainingRequests };
    }),
  removeRequest: (id) =>
    set((state) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [id]: _, ...remainingRequests } = state.requests;
      return { requests: remainingRequests };
    }),
  clearRequests: (error) => {
    set((state) => {
      Object.keys(state.requests).forEach((id) => {
        state.requests[id]?.reject(error);
      });
      return { requests: {} };
    });
  },

  addNotification: (id, resolve, reject) =>
    set((state) => ({
      notifications: {
        ...state.notifications,
        [id]: { resolve, reject },
      },
    })),
  resolveNotification: (id) =>
    set((state) => {
      const notification = state.notifications[id];
      if (notification) {
        notification.resolve();
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [id]: _, ...remainingNotifications } = state.notifications;
      return { notifications: remainingNotifications };
    }),
  rejectNotification: (id, error) =>
    set((state) => {
      const notification = state.notifications[id];
      if (notification) {
        notification.reject(error);
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [id]: _, ...remainingNotifications } = state.notifications;
      return { notifications: remainingNotifications };
    }),
  removeNotification: (id) =>
    set((state) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [id]: _, ...remainingNotifications } = state.notifications;
      return { notifications: remainingNotifications };
    }),
}));
