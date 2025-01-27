import { WebSocket } from "ws";
import { ClientAcceptedMessage, Context, ID, LspError, ServerLspNotification, SuccessfulServerLspResponse } from ".";

export const ProxyErrorObject: Record<number, LspError> = {
  0: {
    code: 0,
    message: "The request wasn't processed because the lsp proxy is not initialized yet. Please wait.",
  },
  1: {
    code: 1,
    message: "The request wasn't processed because the file manager hasn't been initialized yet. Please wait",
  },
  9999999: {
    code: 9999999,
    message: "Error handling logic not implemented yet.",
  },
};

export default class WebSocketClient {
  private user: WebSocket;
  private context?: Context;
  private id?: ID;

  constructor(user: WebSocket) {
    this.user = user;
  }

  withId(id: ID) {
    this.id = id;
  }

  withContext(context: Context) {
    this.context = context;
  }

  sendRequest(message: unknown) {
    this.send({ type: "server-to-client-request", message });
  }

  sendNotification(result: ServerLspNotification) {
    this.send({ type: "server-to-client-notification", message: result });
  }

  sendSuccessConfirmation() {
    this.send({ type: "server-to-client-confirmation", message: { result: { success: true } } });
  }

  sendResponse(result: SuccessfulServerLspResponse) {
    this.send({ type: "server-to-client-response", message: result });
  }

  sendResponseError(error: LspError) {
    this.send({ type: "server-to-client-response", message: { error } });
  }

  private send(response: Pick<ClientAcceptedMessage, "type" | "message">) {
    this.user.send(JSON.stringify({ id: this.id, ctx: this.context, ...response }));
  }
}
