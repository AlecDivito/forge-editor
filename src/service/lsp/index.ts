import {
  CompletionParams,
  DidChangeTextDocumentParams,
  DidChangeWatchedFilesParams,
  DidCloseTextDocumentParams,
  DidOpenTextDocumentParams,
  DocumentDiagnosticParams,
  InitializeParams,
  InitializeResult,
} from "vscode-languageserver-protocol";
import { WorkspaceFoldersInitializeParams } from "vscode-languageserver-protocol/lib/common/protocol.workspaceFolder";
import { FileExtension } from "./proxy";

interface TextDocumentHover {
  textDocument: {
    uri: string;
  };
  position: {
    line: number;
    character: number;
  };
}

interface TextDocumentDidSave {
  textDocument: {
    uri: string;
  };
}

interface TextDocumentDefinition {
  textDocument: {
    uri: string;
  };
  position: {
    line: number;
    character: number;
  };
}

interface TextDocumentReferences {
  textDocument: {
    uri: string;
  };
  position: {
    line: number;
    character: number;
  };
  context: {
    includeDeclaration: boolean;
  };
}

interface TextDocumentRename {
  textDocument: {
    uri: string;
  };
  position: {
    line: number;
    character: number;
  };
  newName: string;
}

interface TextDocumentSymbol {
  query: string;
}

interface TextDocumentFormatting {
  textDocument: {
    uri: string;
  };
  options: {
    tabSize: number;
    insertSpaces: boolean;
  };
}

interface TextDocumentCodeAction {
  textDocument: {
    uri: string;
  };
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  context: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    diagnostics: any[];
  };
}

type LspCommonResponse = {
  id: string | number;
  base: string;
  language?: string;
};

export type LspResponse = LspCommonResponse &
  (
    | { message: LspMessage }
    | { error: { code: number; message: string; data?: unknown } }
    | {
        method: "initialize";
        language: FileExtension;
        result: InitializeResult;
      }
  );

export type LspMessage =
  // Explain the capabilities of the LSP and the client so that they know what
  // each are capable of.
  | {
      method: "initialize";
      params: InitializeParams;
      result?: InitializeResult;
    }
  // A text document was open. You send the entire file to the LSP so that it can
  // Load it into memory.
  | {
      method: "textDocument/didOpen";
      params: DidOpenTextDocumentParams;
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
      params: TextDocumentHover;
    }
  /******* These don't seem to be sent by code mirror integration ******/
  // Triggered when the user saves a document. It lets the LSP perform
  // save-specific actions, such as running linting or formatting.
  // Useful for running on-save validations or automatic code formatting.
  | {
      method: "textDocument/didSave";
      params: TextDocumentDidSave;
    }
  // Triggered when the user requests the definition of a symbol (e.g.,
  // pressing Ctrl+Click on a function or variable). Enables go-to-definition
  // functionality, improving developer productivity.
  | {
      method: "textDocument/definition";
      params: TextDocumentDefinition;
    }
  // Triggered when the user wants to find all references to a symbol in the project.
  // Enables find references functionality, which is essential for code navigation and refactoring.
  | {
      method: "textDocument/references";
      params: TextDocumentReferences;
    }
  // Triggered when the user searches for a symbol in the entire workspace.
  | {
      method: "textDocument/symbol";
      params: TextDocumentSymbol;
    }
  // Triggered when the user requests to format the entire document.
  // Enables code formatting based on the LSP’s rules (e.g., Prettier, Black).
  | {
      method: "textDocument/formatting";
      params: TextDocumentFormatting;
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
      params: TextDocumentCodeAction;
    }
  // Triggered when files in the workspace are added, deleted, or modified.
  // Keeps the LSP aware of workspace file changes for better navigation and analysis.
  | {
      method: "workspace/didChangeWatchedFiles";
      params: DidChangeWatchedFilesParams;
    }
  | {
      method: "workspace/workspaceFolders";
      params: WorkspaceFoldersInitializeParams;
    }
  //Triggered when the user requests to rename a symbol (e.g., a variable or function).
  | {
      method: "textDocument/rename";
      params: TextDocumentRename;
    };

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

export function writeLspMessage(message: LspMessage & { id?: number }): string {
  const jsonRpcMessage = JSON.stringify({ jsonrpc: "2.0", ...message });
  const contentLength = Buffer.byteLength(jsonRpcMessage, "utf-8");
  const str = `Content-Length: ${contentLength}\r\n\r\n${jsonRpcMessage}`;
  console.log(`----\n${str}\n----`);
  return str;
}
