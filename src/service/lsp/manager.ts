import { InitializeParams } from "vscode-languageserver-protocol";
import { FileExtension, LspProxyClientFactory } from "./proxy";
import { ClientLspRequest } from ".";
import { Proxy } from "./proxy";
import WebSocketClient from "./websocket";

export class LspProxyManager {
  private ws: WebSocketClient;
  private workspace: string;
  private initialize: InitializeParams;
  private factory: LspProxyClientFactory;

  private clients: Partial<Record<FileExtension, Proxy>>;
  private spawnPromises: Partial<Record<FileExtension, Promise<Proxy>>> = {};

  constructor(ws: WebSocketClient, workspace: string, initialize: InitializeParams, factory: LspProxyClientFactory) {
    this.ws = ws;
    this.workspace = workspace;
    this.initialize = initialize;
    this.factory = factory;
    this.clients = {};
  }

  set initialization(value: InitializeParams) {
    this.initialize = value;
  }

  getClient(language: FileExtension): Proxy | undefined {
    const proxy = this.clients[language];
    if (proxy?.client?.active()) {
      return proxy;
    }
    return undefined;
  }

  async spawn(language: FileExtension): Promise<Proxy> {
    // What happens when a client doesn't exist?
    // Honestly we should just return none and then not run anything given events
    // that happen. Maybe the editor just won't send any events.
    if (this.spawnPromises[language]) {
      return this.spawnPromises[language]!;
    }

    const spawnPromise = (async () => {
      try {
        if (this.clients[language]) {
          await this.clients[language]?.client.destroy();
        }
        this.clients[language] = await this.factory.spawn(this.ws, {
          ext: language,
          projectName: this.workspace,
          initialize: this.initialize,
        });

        return this.clients[language]!;
      } finally {
        // Cleanup promise cache once the operation is completed
        delete this.spawnPromises[language];
      }
    })();

    this.spawnPromises[language] = spawnPromise;
    return spawnPromise;
  }

  async sendMessageToAll(message: ClientLspRequest): Promise<void> {
    const promises = [];
    for (const proxy of Object.values(this.clients)) {
      promises.push(proxy.client.sendRequest(message));
    }
    await Promise.allSettled(promises);
  }

  async closeAll(): Promise<void> {
    const clients = this.clients;
    this.clients = {};
    const promises = [];
    for (const proxy of Object.values(clients)) {
      promises.push(proxy.client.destroy());
    }
    await Promise.allSettled(promises);
  }
}
