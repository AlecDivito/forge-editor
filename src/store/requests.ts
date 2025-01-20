import { LspResponse } from "@/service/lsp";
import { create } from "zustand";

type RequestStore = {
  requests: Record<
    string,
    {
      resolve: (message: LspResponse) => void;
      reject: (error: Error) => void;
    }
  >;
  addRequest: (
    id: string,
    resolve: (message: LspResponse) => void,
    reject: (error: Error) => void
  ) => void;
  resolveRequest: (id: string, message: LspResponse) => void;
  rejectRequest: (id: string, error: Error) => void;
  removeRequest: (id: string) => void;
};

export const useRequestStore = create<RequestStore>((set) => ({
  requests: {},
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
}));
