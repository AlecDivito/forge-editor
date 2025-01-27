import { join } from "path";
import {
  Proxy,
  FileExtension,
  LspProxyClient,
  LspProxyClientFactory,
  LspProxyClientOptions,
  LspProxyCommonOptions,
} from ".";
import {
  ClientLspNotification,
  ClientLspRequest,
  ID,
  isServerLspNotification,
  isServerLspRequest,
  isServerLspResponse,
  ServerLspNotification,
  ServerLspRequest,
  ServerLspResponse,
  writeLspMessage,
} from "..";
import { spawn, ChildProcessByStdio } from "child_process";
import { existsSync, mkdirSync } from "fs";
import { downloadProject } from "@/service/fs";
import { Readable, Writable } from "stream";
import WebSocketClient from "../websocket";
import { InitializeResult } from "vscode-languageserver-protocol";

const FileExtensionToLsp: Record<FileExtension, { cmd: string; args: string[] }> = {
  go: { cmd: "gopls", args: ["serve"] },
  rs: { cmd: "rust-analyzer", args: [] },
  ts: {
    cmd: "typescript-language-server",
    args: ["--stdio", "--log-level", "4"],
  },
  js: {
    cmd: "typescript-language-server",
    args: ["--stdio", "--log-level", "4"],
  },
  json: { cmd: "vscode-json-languageserver", args: ["--stdio"] },
  md: { cmd: "marksman", args: ["server"] },
  html: { cmd: "vscode-html-languageserver", args: ["--stdio"] },
  css: { cmd: "vscode-css-languageserver", args: ["--stdio"] },
};

interface ProcessOptions {
  baseDirectory: string;
}

export class ProcessLspClientFactory implements LspProxyClientFactory {
  private opts: LspProxyCommonOptions & ProcessOptions;

  constructor(opts: LspProxyCommonOptions & ProcessOptions) {
    this.opts = opts;
  }

  async spawn(wsClient: WebSocketClient, options: LspProxyClientOptions & LspProxyCommonOptions): Promise<Proxy> {
    const { baseDirectory } = this.opts;
    const { ext, projectName, initialize } = options;

    if (!FileExtensionToLsp[ext]) {
      throw new Error(`Unsupported language: ${ext}`);
    }

    const { cmd, args } = FileExtensionToLsp[ext];

    // Figure out what the cwd variable is and set it correctly.
    // We should take `baseDirectory` and `projectName` and create a path
    // for the lsp client to execute in and save files.
    // Lets do `${baseDirectory}/${projectName}/${ext}`
    const cwd = join(baseDirectory, projectName, ext);
    const projectRoot = `file://${process.cwd()}/${cwd}`;

    // Ensure the directory exists, creating it if necessary.
    if (!existsSync(cwd)) {
      mkdirSync(cwd, { recursive: true });
    }

    // Finally go to s3 and download the entire directory to this path
    await downloadProject(process.env.S3_BUCKET!, options.projectName, cwd);

    console.log("Project synced to Server");

    const processClient = new ProcessLspClient(wsClient, projectRoot, projectName, cmd, args, cwd);

    const params = {
      ...initialize,
      rootUri: projectRoot,
      workspaceFolders: [
        {
          uri: projectRoot,
          name: projectName,
        },
      ],
    };

    // for now, we aren't going to return back the initialize request
    const result = await processClient.sendRequest({
      id: 0,
      method: "initialize",
      params,
    });
    if (!result) {
      throw new Error("Failed to successfully start LSP server");
    }
    if (!("result" in result)) {
      throw new Error("Started LSP Server but didn't get back the expected initialization message");
    }

    // Because this is a notification, i don't need to await on it.
    processClient.sendNotification({ method: "initialized", params: {} });

    return {
      client: processClient,
      support: result.result as InitializeResult,
    };
  }
}

export class ProcessLspClient implements LspProxyClient {
  private isActive = true;
  private currentId = 0;

  private client: WebSocketClient;
  private cwd: string;
  private projectName: string;
  private process: ChildProcessByStdio<Writable, Readable, Readable>;
  private messageBuffer: string = "";
  private pendingRequests: Map<ID, (response: ServerLspResponse) => void> = new Map();

  constructor(
    client: WebSocketClient,
    projectRoot: string,
    projectName: string,
    cmd: string,
    args: string[],
    cwd: string,
  ) {
    this.client = client;
    this.cwd = projectRoot;
    this.projectName = projectName;
    this.process = spawn(cmd, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });

    this.process.on("close", () => {
      this.isActive = false;
      console.info(`LSP program closed.`);
    });

    this.process.stderr.on("data", (data) => {
      console.error(`LSP stderr: ${data.toString()}`);
    });

    this.process.stdout.on("data", this.onData.bind(this));
  }

  active(): boolean {
    return this.isActive && this.process.exitCode === null;
  }

  sendNotification(notification: ClientLspNotification) {
    if ("textDocument" in notification.params) {
      notification.params.textDocument.uri = notification.params.textDocument.uri.replace(
        `file:///${this.projectName}`,
        this.cwd,
      );
    }

    this.process.stdin.write(writeLspMessage({ ...notification }), (err) => {
      throw err;
    });
  }

  async sendRequest(message: ClientLspRequest): Promise<ServerLspResponse | undefined> {
    const id = ++this.currentId;
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, resolve);

      // Update the message if it is referencing a textDocument
      if ("textDocument" in message.params) {
        message.params.textDocument.uri = message.params.textDocument.uri.replace(
          `file:///${this.projectName}`,
          this.cwd,
        );
      }

      console.log(`Creating request with ID ${id} for ${message.method}`);
      this.process.stdin.write(writeLspMessage({ ...message, id }), (err) => {
        if (err) {
          this.pendingRequests.delete(id);
          reject(err);
        }
      });
    });
  }

  async destroy(): Promise<void> {
    if (!this.isActive || !this.process) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      this.process.once("exit", (code, signal) => {
        if (code === 0 || signal === "SIGTERM") {
          console.info(`LSP process terminated successfully.`);
          this.isActive = false;
          this.messageBuffer = "";
          this.pendingRequests.clear();
          resolve();
        } else {
          reject(new Error(`Process exited with code ${code}, signal ${signal}`));
        }
      });
      this.process.kill();
    });
  }

  private onData(data: Buffer): void {
    // console.log("+++Received stdio update " + data.toString());
    this.messageBuffer += data.toString();

    while (true) {
      const contentLengthMatch = this.messageBuffer.match(/Content-Length: (\d+)/);
      if (!contentLengthMatch) break;

      const contentLength = parseInt(contentLengthMatch[1], 10);
      const headerEnd = this.messageBuffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) break;

      const start = headerEnd + 4;
      const end = start + contentLength;

      if (this.messageBuffer.length < end) {
        console.log(`${this.messageBuffer.length} is smaller then ${end}. Break;`);
        break;
      }
      console.log(`${this.messageBuffer.length} is equal to ${end}. continue;`);

      let response: ServerLspNotification | ServerLspResponse | ServerLspRequest;

      const stringResponse = this.messageBuffer.slice(start, end);
      try {
        response = JSON.parse(stringResponse);
      } catch {
        console.log("Failed to convert message buffer to json. ");
        console.log(stringResponse);
        break;
      }

      this.messageBuffer = this.messageBuffer.slice(end);

      if (isServerLspRequest(response)) {
        console.log(`Sending Request ${response.method} to client`);
        this.client.sendRequest(response);
      } else if (isServerLspResponse(response)) {
        console.log(`Responding to request ${response.id}`);
        if (this.pendingRequests.has(response.id)) {
          const resolve = this.pendingRequests.get(response.id)!;
          this.pendingRequests.delete(response.id);
          console.log(`Resolving request ${response.id}`);
          resolve(response);
        } else {
          throw new Error("Handling pending requests that aren't recorded is not handled yet.");
        }
      } else if (isServerLspNotification(response)) {
        console.log(`Sending Notification ${response.method}`);
        this.client.sendNotification(response);
      } else {
        console.error(
          `Failed to handle the following response ${JSON.stringify(response, null, 2)}. Not handled by any function`,
        );
        throw new Error(`The JSON response ${JSON.stringify(response, null, 2)} is not handled`);
      }
    }
  }
}
