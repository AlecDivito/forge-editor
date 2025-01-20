import {
  InitializeParams,
  InitializeResult,
} from "vscode-languageserver-protocol";
import { LspMessage, LspResponse } from "..";

export interface Proxy {
  client: LspProxyClient;
  support: InitializeResult;
}

export type FileExtension =
  | "go"
  | "rs"
  | "ts"
  | "js"
  | "json"
  | "md"
  | "html"
  | "css";

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
  spawn(
    options?: LspProxyClientOptions & LspProxyCommonOptions
  ): Promise<Proxy>;
}

export interface LspProxyClient {
  /**
   * Checks to see the LSP Server is active
   */
  active(): boolean;

  /**
   * Sends a message to the process and optionally receives a response.
   * @param message The message to send.
   * @returns A promise that resolves with the response, if any.
   */
  sendMessage(message: LspMessage): Promise<LspResponse | undefined>;

  /**
   * Stops the process or terminates the connection.
   */
  destroy(): Promise<void>;
}

export function writeLspMessage(message: LspMessage): string {
  const updatedRequest = JSON.stringify(message);
  const str = `Content-Length: ${updatedRequest.length}\r\n\r\n${updatedRequest}`;
  return str;
}
