import { WebSocket, WebSocketServer } from "ws";
import { IncomingMessage } from "http";
import { LspProxyMessage } from "@/hooks/use-send-message";
import { LspProxyManager } from "@/service/lsp/manager";
import { ProcessLspClientFactory } from "@/service/lsp/proxy/process";
import { LspResponse } from "@/service/lsp";
import { FileExtension } from "@/service/lsp/proxy";
import { CacheManager } from "@/service/lsp/cache";
import { LspEventHandler } from "@/service/lsp/events";

function newError(
  request: LspProxyMessage,
  code: number,
  message: string
): LspResponse {
  return {
    id: request.id,
    base: request.base,
    language: request.language,
    error: {
      code,
      message,
      data: {},
    },
  };
}

export async function SOCKET(
  client: WebSocket,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  request: IncomingMessage,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  wss: WebSocketServer
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
      const wsRequest = JSON.parse(body.toString()) as LspProxyMessage;
      const { id, base, language, message: parsed } = wsRequest;

      // Initialize the LSP proxy
      if (parsed.method === "initialize") {
        if (!cacheManager) {
          cacheManager = new CacheManager(process.env.S3_BUCKET!, base);
        }
        if (!manager) {
          console.log(
            "Received initialize request. Creating LSP manager for client."
          );
          manager = new LspProxyManager(
            base,
            parsed.params,
            new ProcessLspClientFactory({ baseDirectory: ".workspace-cache" })
          );
          // Return the request to the user to acknowledge initialization
          client.send(JSON.stringify(wsRequest));
        } else {
          console.log("Updating Proxy manager initialization config");
          manager.initialization = parsed.params;
        }
        return;
      }

      // Make sure the manager has been created.
      if (!manager) {
        client.send(
          JSON.stringify(
            newError(
              wsRequest,
              0,
              "The request wasn't processed because the lsp proxy is not initialized yet. Please wait."
            )
          )
        );
        return;
      }

      if (!cacheManager) {
        client.send(
          JSON.stringify(
            newError(
              wsRequest,
              1,
              "The request wasn't processed because the file manager hasn't been initialized yet. Please wait"
            )
          )
        );
        return;
      }

      // Make sure the language is set for messages that require it
      if (!language) {
        if (parsed.method == "workspace/didChangeWatchedFiles") {
          // If the language isn't set and a file change event happened, then we need to
          // handle the event. Just create the file.
          for (const change of parsed.params.changes) {
            if (change.type === 1) {
              const uri = change.uri.replace("file:///", "");
              await cacheManager.createDocument(uri);
              // client.send(
              //   JSON.stringify({
              //     message: {
              //       method: "textDocument/didOpen",
              //       params: { textDocument },
              //     },
              //   })
              // );
            } else if (change.type === 3) {
              console.error(
                "Deleting documents is currently not not supported"
              );
              // await cacheManager.deleteDocument(change.uri)
            }
          }

          client.send(
            JSON.stringify({
              id,
              base,
              language,
              message: parsed,
            })
          );
          return;
        }

        client.send(
          JSON.stringify(
            newError(
              wsRequest,
              1,
              "The request wasn't processed because the language wasn't set on the request."
            )
          )
        );
        return;
      }

      // The manager and the client exists. Now we do a check to make sure the
      // language server is prepared to take updates.
      const lang = language as FileExtension;
      let proxy = manager.getClient(lang);
      if (!proxy) {
        proxy = await manager.spawn(lang);
        // Send the initialization back down to the client
        client.send(
          JSON.stringify({
            method: "initialize",
            language: lang,
            result: proxy.support,
          } as LspResponse)
        );
        // Continue on with our regularly scheduled programming.
      }

      // Some methods are forwarded to the proxy to be handled. While others
      // are intercepted to be processed by the proxy for collaborative editing
      // and syncing files to S3.
      console.log(JSON.stringify(parsed, null, 2));
      const eventHandler = new LspEventHandler(proxy, cacheManager);

      if (parsed.method === "textDocument/didOpen") {
        const output = await eventHandler.textDocumentDidOpen(parsed.params);
        const response = {
          id,
          base,
          language,
          ...output,
        } as LspResponse;
        // Latter we'll handle being the authority of changes and preparing that here
        client.send(JSON.stringify(response));
        return;
      } else if (parsed.method === "textDocument/didChange") {
        await eventHandler.textDocumentDidChange(parsed.params);
        client.send(
          JSON.stringify({
            id,
            base,
            language,
            message: parsed,
          })
        );
        return;
      } else if (parsed.method === "textDocument/didClose") {
        await eventHandler.textDocumentDidClose(parsed.params);
        client.send(
          JSON.stringify({
            id,
            base,
            language,
            message: parsed,
          })
        );
      } else if (parsed.method === "textDocument/completion") {
        const result = await eventHandler.textDocumentCompletion(parsed.params);
        client.send(
          JSON.stringify({
            id,
            base,
            language,
            message: result,
          })
        );
      } else if (parsed.method === "textDocument/hover") {
        const result = await eventHandler.textDocumentCompletion(parsed.params);
        client.send(
          JSON.stringify({
            id,
            base,
            language,
            message: result,
          })
        );
      }

      // if (parsed.method === "workspace/workspaceFolders") {
      //   // console.log(
      //   //   `------ Updating workspace folders for language ${language}`
      //   // );
      //   // const { workspaceFolders } = parsed.params;
      //   // if (workspaceFolders) {
      //   //   workspaceFoldersCache[language] = workspaceFolders;
      //   // }
      //   // TODO: Alec, we need to load in the S3 bucket
      // }
    } catch (error) {
      console.error("Error processing client message:", error);
    }
  });
}

export const config = {
  api: {
    bodyParser: false,
  },
};
