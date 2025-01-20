import { join } from "path";
import {
  Proxy,
  FileExtension,
  LspProxyClient,
  LspProxyClientFactory,
  LspProxyClientOptions,
  LspProxyCommonOptions,
} from ".";
import { LspMessage, LspResponse, writeLspMessage } from "..";
import { spawn, ChildProcessByStdio } from "child_process";
import { existsSync, mkdirSync } from "fs";
import { downloadProject } from "@/service/fs";
import { Readable, Writable } from "stream";

const FileExtensionToLsp: Record<
  FileExtension,
  { cmd: string; args: string[] }
> = {
  go: { cmd: "gopls", args: ["serve"] },
  rs: { cmd: "rust-analyzer", args: [] },
  ts: { cmd: "typescript-language-server", args: ["--stdio"] },
  js: { cmd: "typescript-language-server", args: ["--stdio"] },
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

  async spawn(
    options: LspProxyClientOptions & LspProxyCommonOptions
  ): Promise<Proxy> {
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
    downloadProject(process.env.S3_BUCKET!, options.projectName, cwd);

    const client = new ProcessLspClient(
      projectRoot,
      projectName,
      cmd,
      args,
      cwd
    );

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
    const result = await client.sendMessage({ method: "initialize", params });
    if (!result) {
      throw new Error("Failed to successfully start LSP server");
    }
    if (!("result" in result)) {
      throw new Error(
        "Started LSP Server but didn't get back the expected initialization message"
      );
    }

    return { client, support: result.result };
  }
}

export class ProcessLspClient implements LspProxyClient {
  private isActive = true;
  private currentId = 0;

  private cwd: string;
  private projectName: string;
  private process: ChildProcessByStdio<Writable, Readable, Readable>;
  private messageBuffer: string = "";
  private pendingRequests: Map<number, (response: LspResponse) => void> =
    new Map();

  constructor(
    projectRoot: string,
    projectName: string,
    cmd: string,
    args: string[],
    cwd: string
  ) {
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

  async sendMessage(message: LspMessage): Promise<LspResponse | undefined> {
    const id = ++this.currentId;
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, resolve);

      // Update the message if it is referencing a textDocument
      if ("textDocument" in message.params) {
        message.params.textDocument.uri =
          message.params.textDocument.uri.replace(
            `file:///${this.projectName}`,
            this.cwd
          );
      }

      let m: LspMessage & { id?: number } = message;
      // If the method is an notification, don't attach an id
      if (m.method !== "textDocument/didChange") {
        m = { ...m, id };
      }

      this.process.stdin.write(writeLspMessage(m), (err) => {
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
          reject(
            new Error(`Process exited with code ${code}, signal ${signal}`)
          );
        }
      });
      this.process.kill();
    });
  }

  private onData(data: Buffer): void {
    this.messageBuffer += data.toString();

    while (true) {
      const contentLengthMatch = this.messageBuffer.match(
        /Content-Length: (\d+)/
      );
      if (!contentLengthMatch) break;

      const contentLength = parseInt(contentLengthMatch[1], 10);
      const headerEnd = this.messageBuffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) break;

      const start = headerEnd + 4;
      const end = start + contentLength;

      if (this.messageBuffer.length < end) break;

      const response = JSON.parse(this.messageBuffer.slice(start, end));
      this.messageBuffer = this.messageBuffer.slice(end);

      if (response.id && this.pendingRequests.has(response.id)) {
        const resolve = this.pendingRequests.get(response.id)!;
        this.pendingRequests.delete(response.id);
        console.log(
          `---\nResolving Message\n${JSON.stringify(response)}\n----`
        );
        resolve(response as LspResponse);
      }
    }
  }
}
