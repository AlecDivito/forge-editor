import {
  CodeAction,
  CodeActionParams,
  Command,
  CompletionItem,
  CompletionList,
  CompletionParams,
  DidChangeTextDocumentParams,
  DidCloseTextDocumentParams,
  DidOpenTextDocumentParams,
  DocumentSymbol,
  DocumentSymbolParams,
  Hover,
  HoverParams,
  InitializeResult,
  SignatureHelp,
  SignatureHelpParams,
} from "vscode-languageserver-protocol";
import { ClientLspNotification } from ".";
import { LspProxyClient, Proxy } from "./proxy";
import { VirtualEditorManager } from "./virtualEditor";

export class LspEventHandler {
  private proxy: LspProxyClient;
  private editor: VirtualEditorManager;
  private support: InitializeResult;

  constructor(proxy: Proxy, editor: VirtualEditorManager) {
    this.proxy = proxy.client;
    this.support = proxy.support;
    this.editor = editor;
  }

  async textDocumentDidOpen(params: DidOpenTextDocumentParams): Promise<DidOpenTextDocumentParams> {
    const path = this.convertFileUriToFilesystemUri(params.textDocument);
    const textDocument = await this.editor.open(path);

    const overrideParams: DidOpenTextDocumentParams = {
      textDocument: {
        ...textDocument,
        uri: params.textDocument.uri,
      },
    };

    const message: ClientLspNotification = {
      method: "textDocument/didOpen",
      params: overrideParams,
    };

    this.proxy.sendNotification(message);

    overrideParams.textDocument.uri = params.textDocument.uri;
    return overrideParams;
  }

  async textDocumentDidChange(params: DidChangeTextDocumentParams): Promise<void> {
    const { textDocument, contentChanges } = params;
    const cacheFilePath = this.convertFileUriToFilesystemUri(textDocument);
    const version = textDocument.version;

    try {
      const promises = [
        this.editor.applyChanges(cacheFilePath, version, contentChanges),
        this.proxy.sendNotification({
          method: "textDocument/didChange",
          params,
        }),
      ];
      const [cacheApplied, proxyApply] = await Promise.allSettled(promises);
      if (cacheApplied.status === "rejected") {
        throw new Error(`Updating the cache failed because ${cacheApplied.reason}. Stop the program`);
      }
      if (proxyApply.status === "rejected") {
        console.error(`Updating the proxy was rejected and failed because ${proxyApply.reason}`);
      } else {
        // console.log(JSON.stringify(proxyApply.value, null, 2));
      }
      console.log(`Successfully applied changes to document: ${cacheFilePath}`);
    } catch (error) {
      console.error(`Failed to apply changes to ${cacheFilePath}:`, error);
      throw error;
    }
  }

  async textDocumentDidClose(params: DidCloseTextDocumentParams): Promise<void> {
    const { textDocument } = params;
    const cacheFilePath = this.convertFileUriToFilesystemUri(textDocument);

    try {
      const promises = [
        this.editor.close(cacheFilePath),
        this.canOpenClose()
          ? this.proxy.sendNotification({
              method: "textDocument/didClose",
              params,
            })
          : Promise.resolve(),
      ];
      const [cacheApplied, proxyApply] = await Promise.allSettled(promises);
      if (cacheApplied.status === "rejected") {
        throw new Error(`Updating the cache failed because ${cacheApplied.reason}. Stop the program`);
      }
      if (proxyApply.status === "rejected") {
        console.error(`Updating the proxy was rejected and failed because ${proxyApply.reason}`);
      } else {
        // console.log(JSON.stringify(proxyApply.value, null, 2));
      }
      console.log(`Successfully applied changes to document: ${cacheFilePath}`);
    } catch (error) {
      console.error(`Failed to apply changes to ${cacheFilePath}:`, error);
    }
  }

  async textDocumentCompletion(
    params: CompletionParams,
  ): Promise<{ result: CompletionItem[] | CompletionList | null }> {
    try {
      const result = await this.proxy.sendRequest({
        method: "textDocument/completion",
        params,
      });

      if (!result) {
        throw new Error("Failed to create a response for completion request.");
      }

      return result as { result: CompletionItem[] | CompletionList | null };
    } catch (error) {
      console.error(`Failed to complete completion event ${params}:`, error);
      throw error;
    }
  }

  async textDocumentHover(params: HoverParams): Promise<{ result: Hover | null }> {
    try {
      const result = await this.proxy.sendRequest({
        method: "textDocument/hover",
        params,
      });

      if (!result) {
        throw new Error("Failed to complete hover request");
      }

      return result as { result: Hover | null };
    } catch (error) {
      console.error(`Failed to complete hover event ${params}:`, error);
      throw error;
    }
  }

  async textDocumentDocumentSymbol(params: DocumentSymbolParams): Promise<DocumentSymbol> {
    try {
      const result = await this.proxy.sendRequest({
        method: "textDocument/documentSymbol",
        params,
      });

      if (!result) {
        throw new Error("Failed to create document symbol request");
      }

      // console.log(JSON.stringify(result, null, 2));
      return result as DocumentSymbol;
    } catch (error) {
      console.error(`Failed to complete hover event ${params}:`, error);
      throw error;
    }
  }

  async textDocumentSignatureHelp(params: SignatureHelpParams): Promise<{ result: SignatureHelp | null }> {
    try {
      const result = await this.proxy.sendRequest({
        method: "textDocument/signatureHelp",
        params,
      });

      if (!result) {
        throw new Error("Failed to create document symbol request");
      }

      // console.log(JSON.stringify(result, null, 2));
      return { ...result } as { result: SignatureHelp | null };
    } catch (error) {
      console.error(`Failed to complete hover event ${params}:`, error);
      throw error;
    }
  }

  async textDocumentCodeAction(params: CodeActionParams): Promise<{ result: (Command | CodeAction)[] | null }> {
    try {
      const result = await this.proxy.sendRequest({
        method: "textDocument/codeAction",
        params,
      });

      if (!result) {
        throw new Error("Failed to create document symbol request");
      }

      // console.log(JSON.stringify(result, null, 2));
      return { ...result } as { result: (Command | CodeAction)[] | null };
    } catch (error) {
      console.error(`Code Action is not supported ${params}:`, error);
      throw error;
    }
  }

  async textDocumentDelete(params: { path: string });

  private convertFileUriToFilesystemUri(textDocument: { uri: string }): string {
    return textDocument.uri.replace("file:///", "/");
  }

  private canOpenClose(): boolean {
    const textDocSync = this.support?.capabilities.textDocumentSync;

    const result =
      !!textDocSync && typeof textDocSync === "object" && "openClose" in textDocSync && textDocSync.openClose;
    if (!result) {
      return false;
    } else {
      return true;
    }
  }
}
