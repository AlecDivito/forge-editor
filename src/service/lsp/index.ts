import { DirectoryEntry } from "@/lib/storage";
import {
  CodeAction,
  CodeActionParams,
  Command,
  CompletionItem,
  CompletionList,
  CompletionParams,
  ConfigurationParams,
  DefinitionParams,
  DidChangeTextDocumentParams,
  DidChangeWatchedFilesParams,
  DidCloseTextDocumentParams,
  DidOpenTextDocumentParams,
  DidSaveTextDocumentParams,
  DocumentDiagnosticParams,
  DocumentFormattingParams,
  DocumentSymbolParams,
  FileChangeType,
  Hover,
  HoverParams,
  InitializeParams,
  InitializeResult,
  LogTraceParams,
  PublishDiagnosticsParams,
  ReferenceParams,
  RenameParams,
  SignatureHelp,
  SignatureHelpParams,
} from "vscode-languageserver-protocol";
import { WorkspaceFoldersInitializeParams } from "vscode-languageserver-protocol/lib/common/protocol.workspaceFolder";

export type LspOutput = ServerLspNotification | ServerLspResponse | ServerLspRequest;

export function isServerLspRequest(output: LspOutput): output is ServerLspRequest {
  return "id" in output && "method" in output && "params" in output;
}

export function isServerLspResponse(output: LspOutput): output is ServerLspResponse {
  return "id" in output && ("result" in output || "error" in output);
}

export function isServerLspNotification(output: LspOutput): output is ServerLspNotification {
  return "method" in output && "params" in output;
}

export type ServerLspRequest = {
  jsonrpc: "2.0";
  id: ID;
} & {
  method: "workspace/configuration";
  params: ConfigurationParams;
};

export type ServerLspResponse = {
  jsonrpc: "2.0";
  id: ID;
  result?: SuccessfulServerLspResponse;
  error?: LspError;
};

interface DidChangeWatchedFileSystemFilesParams {
  changes: (DirectoryEntry & { type: FileChangeType })[];
}

export type ServerLspNotification =
  | { method: "$/logTrace"; params: LogTraceParams }
  | { method: "$/typescriptVersion"; params: { version: string; source: string } }
  | { method: "window/logMessage"; params: { type: number; message: string } }
  | { method: "textDocument/publishDiagnostics"; params: PublishDiagnosticsParams }
  // The following are custom messages that a client editor should implement if
  // they want to be able to use the proxy as the source of truth
  | { method: "proxy/initialize"; language: string; params: InitializeResult }
  | { method: "proxy/filesystem/created"; params: { uri: string } }
  | { method: "proxy/filesystem/open"; params: DidOpenTextDocumentParams }
  | { method: "proxy/filesystem/close"; params: DidCloseTextDocumentParams }
  | { method: "proxy/filesystem/changed"; params: DidChangeWatchedFileSystemFilesParams };

export type ID = string | number;

export type Context = {
  workspace: string;
  language?: string;
};

export type ServerAcceptedMessage = { id: ID; ctx: Context } & (
  | { type: "client-to-server-notification"; message: ClientLspNotification }
  | { type: "client-to-server-request"; message: ClientLspRequest }
  | { type: "client-to-server-response"; message: { method: "unknown"; params: unknown } }
);

export type ClientAcceptedMessage = { id: ID; ctx: Context } & (
  | { type: "server-to-client-confirmation"; message: { result: boolean } }
  | { type: "server-to-client-response"; message: ClientLspResponse }
  | { type: "server-to-client-notification"; message: ServerLspNotification }
  | { type: "server-to-client-request"; message: unknown }
);

export interface LspError extends Error {
  code: number;
  message: string;
  data?: unknown;
}

export type SuccessfulServerLspResponse =
  | { method: "textDocument/completion"; result: CompletionItem[] | CompletionList | null }
  | { method: "initialize"; result: InitializeResult }
  | { method: "textDocument/hover"; result: Hover | null }
  | { method: "textDocument/signatureHelp"; result: SignatureHelp | null }
  | { method: "textDocument/codeAction"; result: (Command | CodeAction)[] | null };

export type ClientLspResponse = { error: LspError } | SuccessfulServerLspResponse;

export type ClientLspNotification =
  | {
      method: "initialized";
      params: object;
    }
  // A text document was open. You send the entire file to the LSP so that it can
  // Load it into memory.
  | {
      method: "textDocument/didOpen";
      params: DidOpenTextDocumentParams;
    }
  // Triggered when files in the workspace are added, deleted, or modified.
  // Keeps the LSP aware of workspace file changes for better navigation and analysis.
  | {
      method: "workspace/didChangeWatchedFiles";
      params: DidChangeWatchedFilesParams;
    }
  // The text document was closed. Can be shared with the LSP.
  | {
      method: "textDocument/didClose";
      params: DidCloseTextDocumentParams;
    }
  // Sends all of the changes about the document after it's been open. It's used
  // to keep the language server's in-memory representation of the file
  // synchronized with the editor.
  | {
      method: "textDocument/didChange";
      params: DidChangeTextDocumentParams;
    };

export type ClientLspRequest =
  | {
      method: "initialize";
      params: InitializeParams;
    }

  // editor sends a request asking for possible completions. Ether triggered manually
  // or by the eidtor. Suggestions for variable names, function calls, classes,
  // and snippets.
  | {
      method: "textDocument/completion";
      params: CompletionParams;
    }
  // Send to the LSP when a user hovers their mouse over a piece of text. It
  // provides context-sensitive information like type, documentation or symbol
  // definition.
  | {
      method: "textDocument/hover";
      params: HoverParams;
    }
  /******* These don't seem to be sent by code mirror integration ******/
  // Triggered when the user saves a document. It lets the LSP perform
  // save-specific actions, such as running linting or formatting.
  // Useful for running on-save validations or automatic code formatting.
  | {
      method: "textDocument/didSave";
      params: DidSaveTextDocumentParams;
    }
  // Triggered when the user requests the definition of a symbol (e.g.,
  // pressing Ctrl+Click on a function or variable). Enables go-to-definition
  // functionality, improving developer productivity.
  | {
      method: "textDocument/definition";
      params: DefinitionParams;
    }
  // Triggered when the user wants to find all references to a symbol in the project.
  // Enables find references functionality, which is essential for code navigation and refactoring.
  | {
      method: "textDocument/references";
      params: ReferenceParams;
    }
  // Triggered when the user searches for a symbol in the entire workspace.
  | {
      method: "textDocument/symbol";
      params: DocumentSymbolParams;
    }
  // Triggered when the user requests to format the entire document.
  // Enables code formatting based on the LSP’s rules (e.g., Prettier, Black).
  | {
      method: "textDocument/formatting";
      params: DocumentFormattingParams;
    }
  // Triggered when the LSP wants to send diagnostic information (e.g., errors, warnings) about the document.
  // Enables real-time linting and error checking.
  | {
      method: "textDocument/diagnostic";
      params: DocumentDiagnosticParams;
    }
  // Triggered when the user requests available code actions (e.g., quick fixes, refactoring suggestions).
  // Enables quick fixes, like automatically importing missing modules or suggesting code optimizations.
  | {
      method: "textDocument/codeAction";
      params: CodeActionParams;
    }
  | {
      method: "workspace/workspaceFolders";
      params: WorkspaceFoldersInitializeParams;
    }
  //Triggered when the user requests to rename a symbol (e.g., a variable or function).
  | {
      method: "textDocument/rename";
      params: RenameParams;
    }
  | {
      method: "textDocument/documentSymbol";
      params: DocumentSymbolParams;
    }
  | {
      method: "textDocument/signatureHelp";
      params: SignatureHelpParams;
    };
// | {
//   method: "proxy/git/"
// };

export function getLsp(language?: string): {
  cmd: string;
  args: string[];
} {
  const supportedLSPs: Record<string, { cmd: string; args: string[] }> = {
    go: { cmd: "gopls", args: ["serve"] },
    rs: { cmd: "rust-analyzer", args: [] },
    ts: { cmd: "typescript-language-server", args: ["--stdio"] },
    js: { cmd: "typescript-language-server", args: ["--stdio"] },
    json: { cmd: "vscode-json-languageserver", args: ["--stdio"] },
    md: { cmd: "markdown-language-server", args: ["--stdio"] },
    html: { cmd: "vscode-html-languageserver", args: ["--stdio"] },
    css: { cmd: "vscode-css-languageserver", args: ["--stdio"] },
    // py: { cmd: "pyls", args: [] },
    // yaml: { cmd: "yaml-language-server", args: ["--stdio"] },
  };

  if (!language) {
    throw new Error("No language was defined or passed in.");
  }

  const { cmd, args } = supportedLSPs[language] || {};
  if (!cmd) {
    throw new Error(`Unsupported language: ${language}`);
  }

  return { cmd, args };
  /*
      client.send(JSON.stringify({ error: `Unsupported language: ${language}` }));
      client.close();
    */
}

export function writeLspMessage(message: (ClientLspRequest & { id?: number }) | ClientLspNotification): string {
  const jsonRpcMessage = JSON.stringify({ jsonrpc: "2.0", ...message });
  const contentLength = Buffer.byteLength(jsonRpcMessage, "utf-8");
  const str = `Content-Length: ${contentLength}\r\n\r\n${jsonRpcMessage}`;
  // console.log(`----\n${str}\n----`);
  return str;
}
