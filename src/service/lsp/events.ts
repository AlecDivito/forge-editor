import {
  CompletionParams,
  DidChangeTextDocumentParams,
  DidCloseTextDocumentParams,
  DidOpenTextDocumentParams,
  HoverParams,
  InitializeResult,
} from "vscode-languageserver-protocol";
import { CacheManager } from "./cache";
import { LspMessage } from ".";
import { LspProxyClient, Proxy } from "./proxy";

export class LspEventHandler {
  private proxy: LspProxyClient;
  private cache: CacheManager;
  private support: InitializeResult;

  constructor(proxy: Proxy, cache: CacheManager) {
    this.proxy = proxy.client;
    this.support = proxy.support;
    this.cache = cache;
  }

  async textDocumentDidOpen(
    params: DidOpenTextDocumentParams
  ): Promise<{ message: LspMessage }> {
    const cacheFilePath = this.convertFileUriToS3Uri(params.textDocument);
    const textDocument = await this.cache.getDocument(cacheFilePath);

    const message: LspMessage = {
      method: "textDocument/didOpen",
      params: {
        textDocument: {
          ...textDocument,
          uri: params.textDocument.uri,
        },
      },
    };

    if (this.canOpenClose()) {
      const response = await this.proxy.sendMessage(message);
      console.log(JSON.stringify(response, null, 2));
    }

    // Convert the path back to the format we expect on the frontend
    message.params.textDocument.uri = cacheFilePath;
    return { message };
  }

  async textDocumentDidChange(params: DidChangeTextDocumentParams) {
    const { textDocument, contentChanges } = params;
    const cacheFilePath = this.convertFileUriToS3Uri(textDocument);
    const version = textDocument.version;

    try {
      const promises = [
        this.cache.applyChanges(cacheFilePath, version, contentChanges),
        this.proxy.sendMessage({ method: "textDocument/didChange", params }),
      ];
      const [cacheApplied, proxyApply] = await Promise.allSettled(promises);
      if (cacheApplied.status === "rejected") {
        throw new Error(
          `Updating the cache failed because ${cacheApplied.reason}. Stop the program`
        );
      }
      if (proxyApply.status === "rejected") {
        console.error(
          `Updating the proxy was rejected and failed because ${proxyApply.reason}`
        );
      } else {
        console.log(JSON.stringify(proxyApply.value, null, 2));
      }
      console.log(`Successfully applied changes to document: ${cacheFilePath}`);
    } catch (error) {
      console.error(`Failed to apply changes to ${cacheFilePath}:`, error);
    }
  }

  async textDocumentDidClose(params: DidCloseTextDocumentParams) {
    const { textDocument } = params;
    const cacheFilePath = this.convertFileUriToS3Uri(textDocument);

    try {
      const promises = [
        this.cache.syncDocumentToS3(cacheFilePath),
        this.canOpenClose()
          ? this.proxy.sendMessage({ method: "textDocument/didClose", params })
          : Promise.resolve(),
      ];
      const [cacheApplied, proxyApply] = await Promise.allSettled(promises);
      if (cacheApplied.status === "rejected") {
        throw new Error(
          `Updating the cache failed because ${cacheApplied.reason}. Stop the program`
        );
      }
      if (proxyApply.status === "rejected") {
        console.error(
          `Updating the proxy was rejected and failed because ${proxyApply.reason}`
        );
      } else {
        console.log(JSON.stringify(proxyApply.value, null, 2));
      }
      console.log(`Successfully applied changes to document: ${cacheFilePath}`);
    } catch (error) {
      console.error(`Failed to apply changes to ${cacheFilePath}:`, error);
    }
  }

  async textDocumentCompletion(params: CompletionParams) {
    try {
      const result = await this.proxy.sendMessage({
        method: "textDocument/completion",
        params,
      });
      console.log(JSON.stringify(result, null, 2));
      return result;
    } catch (error) {
      console.error(`Failed to complete completion event ${params}:`, error);
    }
  }

  async textDocumentHover(params: HoverParams) {
    try {
      const result = await this.proxy.sendMessage({
        method: "textDocument/hover",
        params,
      });
      console.log(JSON.stringify(result, null, 2));
      return result;
    } catch (error) {
      console.error(`Failed to complete hover event ${params}:`, error);
    }
  }

  private convertFileUriToS3Uri(textDocument: { uri: string }): string {
    return textDocument.uri.replace("file:///", "");
  }

  private canOpenClose(): boolean {
    const textDocSync = this.support?.capabilities.textDocumentSync;

    const result =
      !!textDocSync &&
      typeof textDocSync === "object" &&
      "openClose" in textDocSync &&
      textDocSync.openClose;
    if (!result) {
      return false;
    } else {
      return true;
    }
  }
}
