import { InitializeParams, InitializeResult } from "vscode-languageserver-protocol";
import { ClientLspNotification, ClientLspRequest } from "..";
import WebSocketClient from "../websocket";

export interface Proxy {
  client: LspProxyClient;
  support: InitializeResult;
}

export type FileExtension = "go" | "rs" | "ts" | "js" | "json" | "md" | "html" | "css" | "text";

export interface LspProxyCommonOptions {
  debug?: boolean;
}

export interface LspProxyClientOptions {
  ext: FileExtension;
  projectName: string;
  initialize: InitializeParams;
}

export interface LspProxyClientFactory {
  /**
   * Starts the process or establishes the connection.
   * @param options Initialization options specific to the implementation.
   */
  spawn(client: WebSocketClient, options?: LspProxyClientOptions & LspProxyCommonOptions): Promise<Proxy>;
}

export interface LspProxyClient {
  /**
   * Checks to see the LSP Server is active
   */
  active(): boolean;

  /**
   * Send a notification to the language Server
   * @param message notification The notification to send to the language server
   */
  sendNotification(notification: ClientLspNotification): void;

  /**
   * Sends a message to the process and optionally receives a response.
   * @param message The message to send.
   * @returns A promise that resolves with the response, if any.
   */
  sendRequest(message: ClientLspRequest): Promise<unknown>;

  /**
   * Stops the process or terminates the connection.
   */
  destroy(): Promise<void>;
}

export function writeLspMessage(message: ClientLspRequest): string {
  const updatedRequest = JSON.stringify(message);
  const str = `Content-Length: ${updatedRequest.length}\r\n\r\n${updatedRequest}`;
  return str;
}
