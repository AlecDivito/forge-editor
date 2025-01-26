import { ClientLspNotification, ClientLspRequest } from "@/service/lsp";

export type ClientContext = {
  id: string;
  workspace: string;
  language?: string;
};

export type ClientLspProxyMessage = ClientContext &
  (
    | { type: "request"; message: ClientLspRequest }
    | { type: "notification"; message: ClientLspNotification }
  );
