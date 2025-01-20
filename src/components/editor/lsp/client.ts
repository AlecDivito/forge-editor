import { SendLspMessage } from "@/hooks/use-send-message";
import { LspMessage, LspResponse } from "@/service/lsp";
import {
  CompletionParams,
  DidChangeTextDocumentParams,
  HoverParams,
  ServerCapabilities,
} from "vscode-languageserver-protocol";

// LanguageServerClient: Manages communication with a language server
export class LanguageServerClient {
  private sender: SendLspMessage;
  public capabilities?: ServerCapabilities<unknown> = undefined;

  private documentVersion: number = 0;
  private debounceDelay: number = 500; // 500ms debounce delay

  constructor(sender: SendLspMessage) {
    this.sender = sender;
  }

  async didChange(params: DidChangeTextDocumentParams) {
    console.log("Sending");
    const response = await this.notify({
      method: "textDocument/didChange",
      params,
    });
    return response;
  }

  async hover(params: HoverParams) {
    const response = await this.notify({
      method: "textDocument/hover",
      params,
    });
    return response;
  }

  async completion(params: CompletionParams) {
    const response = await this.notify({
      method: "textDocument/completion",
      params,
    });
    return response;
  }

  private async notify(message: LspMessage): Promise<LspResponse> {
    console.log("notify");
    const response = await this.sender(message);
    return response;
  }
}
