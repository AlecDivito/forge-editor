import {
  CompletionParams,
  DidChangeTextDocumentParams,
  DidCloseTextDocumentParams,
  DidOpenTextDocumentParams,
  DocumentSymbol,
  DocumentSymbolParams,
  Hover,
  HoverParams,
  InitializeResult,
} from "vscode-languageserver-protocol";
import { CacheManager } from "./cache";
import { ClientLspNotification, SuccessfulServerLspResponse } from ".";
import { LspProxyClient, Proxy } from "./proxy";
import { CompletionResult } from "@codemirror/autocomplete";

export class LspEventHandler {
  private proxy: LspProxyClient;
  private cache: CacheManager;
  private support: InitializeResult;

  constructor(proxy: Proxy, cache: CacheManager) {
    this.proxy = proxy.client;
    this.support = proxy.support;
    this.cache = cache;
  }

  async textDocumentDidOpen(params: DidOpenTextDocumentParams): Promise<void> {
    const cacheFilePath = this.convertFileUriToS3Uri(params.textDocument);
    const textDocument = await this.cache.getDocument(cacheFilePath);

    const message: ClientLspNotification = {
      method: "textDocument/didOpen",
      params: {
        textDocument: {
          ...textDocument,
          uri: params.textDocument.uri,
        },
      },
    };

    this.proxy.sendNotification(message);
  }

  async textDocumentDidChange(params: DidChangeTextDocumentParams): Promise<void> {
    const { textDocument, contentChanges } = params;
    const cacheFilePath = this.convertFileUriToS3Uri(textDocument);
    const version = textDocument.version;

    try {
      const promises = [
        this.cache.applyChanges(cacheFilePath, version, contentChanges),
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
        console.log(JSON.stringify(proxyApply.value, null, 2));
      }
      console.log(`Successfully applied changes to document: ${cacheFilePath}`);
    } catch (error) {
      console.error(`Failed to apply changes to ${cacheFilePath}:`, error);
      throw error;
    }
  }

  async textDocumentDidClose(params: DidCloseTextDocumentParams): Promise<void> {
    const { textDocument } = params;
    const cacheFilePath = this.convertFileUriToS3Uri(textDocument);

    try {
      const promises = [
        this.cache.syncDocumentToS3(cacheFilePath),
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
        console.log(JSON.stringify(proxyApply.value, null, 2));
      }
      console.log(`Successfully applied changes to document: ${cacheFilePath}`);
    } catch (error) {
      console.error(`Failed to apply changes to ${cacheFilePath}:`, error);
    }
  }

  async textDocumentCompletion(id: string | number, params: CompletionParams): Promise<CompletionResult> {
    try {
      const result = await this.proxy.sendRequest({
        id,
        method: "textDocument/completion",
        params,
      });

      if (!result) {
        throw new Error("Failed to create a response for completion request.");
      }

      return result as CompletionResult;
    } catch (error) {
      console.error(`Failed to complete completion event ${params}:`, error);
      throw error;
    }
  }

  async textDocumentHover(id: string | number, params: HoverParams): Promise<Hover> {
    try {
      const result = await this.proxy.sendRequest({
        id,
        method: "textDocument/hover",
        params,
      });

      if (!result) {
        throw new Error("Failed to complete hover request");
      }

      return result as Hover;
    } catch (error) {
      console.error(`Failed to complete hover event ${params}:`, error);
      throw error;
    }
  }

  async textDocumentDocumentSymbol(id: string | number, params: DocumentSymbolParams): Promise<DocumentSymbol> {
    try {
      const result = await this.proxy.sendRequest({
        id,
        method: "textDocument/documentSymbol",
        params,
      });

      if (!result) {
        throw new Error("Failed to create document symbol request");
      }

      console.log(JSON.stringify(result, null, 2));
      return result as DocumentSymbol;
    } catch (error) {
      console.error(`Failed to complete hover event ${params}:`, error);
      throw error;
    }
  }

  private convertFileUriToS3Uri(textDocument: { uri: string }): string {
    return textDocument.uri.replace("file:///", "");
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
