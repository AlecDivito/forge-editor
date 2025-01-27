import { SendRequest } from "@/hooks/use-send-message";
import { SendLspNotification } from "@/hooks/use-send-notification";
import { ClientLspNotification, ClientLspRequest, ServerLspResponse, SuccessfulServerLspResponse } from "@/service/lsp";
import {
  CompletionParams,
  DidChangeTextDocumentParams,
  HoverParams,
  ServerCapabilities,
} from "vscode-languageserver-protocol";

// LanguageServerClient: Manages communication with a language server
export class LanguageServerClient {
  private sendRequest: SendRequest;
  private sendNotification: SendLspNotification;
  public capabilities?: ServerCapabilities<unknown> = undefined;

  private documentVersion: number = 0;
  private debounceDelay: number = 500; // 500ms debounce delay

  constructor(sendRequest: SendRequest, sendNotification: SendLspNotification) {
    this.sendRequest = sendRequest;
    this.sendNotification = sendNotification;
  }

  async didChange(params: DidChangeTextDocumentParams) {
    console.log("Sending");
    const response = await this.notify({ method: "textDocument/didChange", params });
    return response;
  }

  async hover(params: HoverParams) {
    const response = await this.request({ method: "textDocument/hover", params });
    return response;
  }

  async completion(params: CompletionParams) {
    const response = await this.request({ method: "textDocument/completion", params });
    return response;
  }

  private async notify(message: ClientLspNotification): Promise<ServerLspResponse> {
    const response = await this.sendNotification(message);
    return response;
  }

  private async request(request: ClientLspRequest): Promise<SuccessfulServerLspResponse> {
    const response = await this.sendRequest(request);
    if ("error" in response) {
      throw new Error(`Request to proxy failed with ${response}`);
    } else if ("result" in response && "method" in response) {
      return response;
    } else {
      throw new Error(`Request is not handled ${JSON.stringify(response, null, 2)}`);
    }
  }
}
