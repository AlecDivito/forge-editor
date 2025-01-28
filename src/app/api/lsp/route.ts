import { WebSocket, WebSocketServer } from "ws";
import { IncomingMessage } from "http";
import { LspProxyManager } from "@/service/lsp/manager";
import { ProcessLspClientFactory } from "@/service/lsp/proxy/process";
import { FileExtension } from "@/service/lsp/proxy";
import { CacheManager } from "@/service/lsp/cache";
import { LspEventHandler } from "@/service/lsp/events";
import WebSocketClient, { ProxyErrorObject } from "@/service/lsp/websocket";
import { LspError, ServerAcceptedMessage } from "@/service/lsp";

export async function SOCKET(
  client: WebSocket,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  request: IncomingMessage,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  wss: WebSocketServer,
) {
  console.log("New LSP WebSocket connection.");
  let cacheManager: CacheManager | undefined = undefined;
  let manager: LspProxyManager | undefined = undefined;
  // TODO: Alec the project name must be validated before it's used because it
  // will be used in the directory name. We should only allow for english characters.

  client.on("close", async () => {
    console.log("Connection closed");
    if (manager) {
      console.log("- Closing all clients");
      await manager.closeAll();
      console.log("- Clients all successfully cleaned up");
    }

    if (cacheManager) {
      console.log("- Syncing all files to S3");
      await cacheManager.syncAllToS3();
      console.log("- All files synced to S3.");
    }
    console.log("Connection cleaned up successfully");
  });

  client.on("message", async (body) => {
    try {
      const requestClient = new WebSocketClient(client);
      const wsRequest = JSON.parse(body.toString()) as ServerAcceptedMessage;
      console.log(JSON.stringify(wsRequest, null, 2));
      const { type, id, ctx, message } = wsRequest;

      if (!["client-to-server-notification", "client-to-server-request", "client-to-server-response"].includes(type)) {
        throw new Error(`Message type ${type} is not supported by proxy.`);
      }

      requestClient.withContext(ctx);
      requestClient.withId(id);

      // Initialize the LSP proxy
      if (type === "client-to-server-request" && message.method === "initialize") {
        if (!cacheManager) {
          cacheManager = new CacheManager(process.env.S3_BUCKET!, ctx.workspace);
        }
        if (!manager) {
          console.log("Received initialize request. Creating LSP manager for client.");
          const proxyClient = new WebSocketClient(client);
          proxyClient.withContext(ctx);
          manager = new LspProxyManager(
            proxyClient,
            ctx.workspace,
            message.params,
            new ProcessLspClientFactory({ baseDirectory: ".workspace-cache" }),
          );
        } else {
          console.log("Updating Proxy manager initialization config");
          manager.initialization = message.params;
        }
        return;
      }

      if (!manager) {
        requestClient.sendResponseError(ProxyErrorObject[0]);
        return;
      }

      if (!cacheManager) {
        requestClient.sendResponseError(ProxyErrorObject[1]);
        return;
      }

      // The manager and the client exists. Now we do a check to make sure the
      // language server is prepared to take updates.
      const lang = ctx.language as FileExtension;
      let proxy = manager.getClient(lang);
      if (!proxy) {
        proxy = await manager.spawn(lang);
        requestClient.sendNotification({ method: "proxy/initialize", language: lang, params: proxy.support });
      }

      const eventHandler = new LspEventHandler(proxy, cacheManager);

      if (type === "client-to-server-request") {
        if (message.method === "textDocument/completion") {
          const result = await eventHandler.textDocumentCompletion(message.params);
          requestClient.sendResponse({ method: message.method, ...result });
        } else if (message.method === "textDocument/hover") {
          const result = await eventHandler.textDocumentHover(message.params);
          requestClient.sendResponse({ method: message.method, ...result });
        } else if (message.method === "workspace/workspaceFolders") {
          await manager.sendMessageToAll(message);
          requestClient.sendSuccessConfirmation();
        }
      } else if (type === "client-to-server-notification") {
        if (message.method === "workspace/didChangeWatchedFiles") {
          for (const change of message.params.changes) {
            if (change.type === 1) {
              const uri = change.uri.replace("file:///", "");
              await cacheManager.createDocument(uri);
            } else if (change.type === 3) {
              throw new Error("Deleting documents is currently not not supported");
              // await cacheManager.deleteDocument(change.uri)
            }
          }
          requestClient.sendSuccessConfirmation();
        } else if (message.method === "textDocument/didOpen") {
          const params = await eventHandler.textDocumentDidOpen(message.params);
          requestClient.sendSuccessConfirmation();
          requestClient.sendNotification({ method: "proxy/textDocument/open", params });
        } else if (message.method === "textDocument/didClose") {
          await eventHandler.textDocumentDidClose(message.params);
          requestClient.sendSuccessConfirmation();
        } else if (message.method === "textDocument/didChange") {
          // TODO: although we respond back with success messages...maybe did change
          // is one we want to skip.
          await eventHandler.textDocumentDidChange(message.params);
          requestClient.sendSuccessConfirmation();
        }
      } else if (type === "client-to-server-response") {
        throw new Error(`Client to Server Responses are currently not supported.`);
      } else {
        throw new Error(`Message type ${type} is not supported in LSP Proxy.`);
      }
    } catch (error: unknown) {
      console.error("Error processing client message:", error);
      const requestClient = new WebSocketClient(client);
      requestClient.sendResponseError(error as LspError);
    }
  });
}

export const config = {
  api: {
    bodyParser: false,
  },
};
