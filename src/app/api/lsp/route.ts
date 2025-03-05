import { WebSocket, WebSocketServer } from "ws";
import { IncomingMessage } from "http";
import { LspProxyManager } from "@/service/lsp/manager";
import { ProcessLspClientFactory } from "@/service/lsp/proxy/process";
import { FileExtension } from "@/service/lsp/proxy";
import { CacheManager } from "@/service/lsp/cache";
import { LspEventHandler } from "@/service/lsp/events";
import WebSocketClient, { ProxyErrorObject } from "@/service/lsp/websocket";
import { LspError, ServerAcceptedMessage } from "@/service/lsp";
import watchman from "fb-watchman";
import { FileChangeType } from "vscode-languageserver-protocol";
import { DirectoryEntry } from "@/lib/storage";

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
  let watchmanClient: watchman.Client | undefined = undefined;
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

    if (watchmanClient) {
      console.log("- Shutting down watchman");
      watchmanClient.removeAllListeners("subscription");
      watchmanClient.end();
      console.log("- Successfully shutdown watchman");
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
        if (!watchmanClient) {
          watchmanClient = new watchman.Client();
          if (watchmanClient) {
            const root = process.env.ROOT_PROJECT_DIRECTORY as string;
            // TODO(Alec): Hard coding for now to prove a point
            const watchPath = `${root}/test/test`;
            watchmanClient.capabilityCheck(
              {
                optional: [],
                required: ["relative_root"],
              },
              (capError, capResp) => {
                if (capError) {
                  console.error("Error checking capabilities:", capError);
                  watchmanClient!.end();
                  return;
                }

                console.log("Watchman capabilities:", capResp);

                // 2) Initiate watch on the target directory
                watchmanClient!.command(["watch-project", watchPath], (watchError, watchResp) => {
                  if (watchError) {
                    console.error("Error initiating watch:", watchError);
                    watchmanClient!.end();
                    return;
                  }

                  // watchResp.watch = the path being watched
                  // watchResp.relative_path = relative path if a watch-project re-mapped
                  const { watch, relative_path } = watchResp;
                  console.log(`Watching ${watch} (relative path: ${relative_path || ""})`);

                  // 3) Set up a subscription
                  //    We'll subscribe to any change (files being created, modified, etc.)
                  const sub = {
                    expression: [
                      "anyof",
                      ["type", "f"], // Files
                      ["type", "d"], // Directories
                    ],
                    relative_root: relative_path,
                    fields: ["name", "exists", "type", "size"],
                  };

                  watchmanClient!.command(
                    ["subscribe", watch, "mysubscription", sub],
                    (subscribeError, subscribeResp) => {
                      if (subscribeError) {
                        console.error("Failed to subscribe:", subscribeError);
                        watchmanClient!.end();
                        return;
                      }
                      console.log("Subscription established:", Object.keys(subscribeResp));
                    },
                  );
                });
              },
            );

            // 4) Handle subscription events (Watchman sends them to the client)
            watchmanClient.on("subscription", (resp) => {
              // Only handle the subscription we named "mysubscription"
              if (resp.subscription !== "mysubscription") {
                return;
              }

              // resp.files contains an array of changed files
              const changes: (DirectoryEntry & { type: FileChangeType })[] = resp.files.map((file) => {
                const { name, exists, size, type } = file;

                let fileTy: "f" | "d";
                let changeTy = FileChangeType.Changed;
                const path = `/${name}`;
                if (type === "f") {
                  fileTy = "f";
                } else if (type === "d") {
                  fileTy = "d";
                } else {
                  return undefined;
                }

                if (!exists) {
                  changeTy = FileChangeType.Deleted;
                } else if (size === 0) {
                  changeTy = FileChangeType.Created;
                } else {
                  changeTy = FileChangeType.Created;
                }

                return { path, name, ty: fileTy, type: changeTy } as DirectoryEntry & {
                  type: FileChangeType;
                };
              });

              requestClient.sendNotification({
                method: "proxy/filesystem/changed",
                params: { changes },
              });
            });
          }
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

      // I think the easiest solution for now would be to handle the generic requests here
      // and do the language specific requests later on in the program. In the future we
      // should try and create a strategy pattern that does this.
      if (type === "client-to-server-request" && message.method === "workspace/workspaceFolders") {
        await manager.sendMessageToAll(message);
        requestClient.sendSuccessConfirmation();
        return;
      } else if (type === "client-to-server-notification" && message.method === "workspace/didChangeWatchedFiles") {
        for (const change of message.params.changes) {
          if (change.type === 1) {
            const uri = change.uri.replace("file:///", "");
            await cacheManager.createDocument(uri);
            requestClient.sendNotification({
              method: "proxy/filesystem/created",
              params: { uri: change.uri },
            });
          } else if (change.type === 3) {
            throw new Error("Deleting documents is currently not not supported");
            // await cacheManager.deleteDocument(change.uri)
          }
        }
        requestClient.sendSuccessConfirmation();
        return;
      }

      // hmm, clients is based on the language, but some calls don't
      // care about the language right, such as workspace calls will
      // just be sent to all of the

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
        } else if (message.method === "textDocument/signatureHelp") {
          const result = await eventHandler.textDocumentSignatureHelp(message.params);
          requestClient.sendResponse({ method: message.method, ...result });
        } else if (message.method === "textDocument/codeAction") {
          const result = await eventHandler.textDocumentCodeAction(message.params);
          requestClient.sendResponse({ method: message.method, ...result });
        }
      } else if (type === "client-to-server-notification") {
        if (message.method === "textDocument/didOpen") {
          const params = await eventHandler.textDocumentDidOpen(message.params);
          requestClient.sendSuccessConfirmation();
          requestClient.sendNotification({ method: "proxy/filesystem/open", params });
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
