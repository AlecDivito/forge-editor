import { LspProxyClient, Proxy } from ".";
import { ClientLspNotification, ClientLspRequest } from "..";

export class NoopLspClient implements LspProxyClient {
  private constructor() {}

  static spawn(): Proxy {
    return {
      client: new NoopLspClient(),
      support: {
        capabilities: {},
      },
    };
  }

  active(): boolean {
    return true;
  }
  sendNotification(_: ClientLspNotification): void {
    return;
  }
  sendRequest(_: ClientLspRequest): Promise<unknown> {
    return Promise.resolve();
  }
  destroy(): Promise<void> {
    return Promise.resolve();
  }
}
