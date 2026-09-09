import { CompletionItem, CompletionList, CompletionParams, Hover, HoverParams } from "vscode-languageserver-protocol";

export type WorkspaceId = string & { readonly __brand: 'WorkspaceId' };
export type FileId = string & { readonly __brand: 'FileId' };
export type ClientId = string & { readonly __brand: 'ClientId' };
export type TerminalId = string & { readonly __brand: 'TerminalId' };
export type LanguageId = string & { readonly __brand: 'LanguageId' };

export interface ClientParams {
  id?: string;
}

export function getClientId(params: ClientParams): ClientId {
  return (params.id ?? "default") as ClientId;
}

export enum ErrorCode { }

export interface LspMethodMap {
  "textDocument/hover": {
    params: Omit<HoverParams, "textDocument">;
    result: Hover | null;
  };
  "textDocument/completion": {
    params: Omit<CompletionParams, "textDocument">;
    result: CompletionItem[] | CompletionList | null
  }
}

export type ClientMessage =
  | {
    kind: "Hello";
  }
  | {
    kind: "DocSubscribe";
    workspace_id: WorkspaceId;
    file_id: FileId;
  }
  | {
    kind: "DocUnsubscribe";
    workspace_id: WorkspaceId;
    file_id: FileId;
  }
  | {
    kind: "DocUpdate";
    workspace_id: WorkspaceId;
    file_id: FileId;
    update: number[];
  }
  | {
    kind: "DocSyncStep1";
    workspace_id: WorkspaceId;
    file_id: FileId;
    state_vector: Uint8Array;
  }
  | {
    kind: "Awareness";
    workspace_id: WorkspaceId;
    file_id: FileId;
    payload: Uint8Array;
  }
  | {
    kind: "TerminalOpen";
    term_id: TerminalId;
    cols: number;
    rows: number;
  }
  | {
    kind: "TerminalInput";
    term_id: TerminalId;
    data: Uint8Array;
  }
  | {
    kind: "TerminalResize";
    term_id: TerminalId;
    cols: number;
    rows: number;
  }
  | {
    kind: "TerminalClose";
    term_id: TerminalId;
  }
  | {
    kind: "LspRequest";
    workspace_id: WorkspaceId;
    file_id: FileId;
    request_id: string;
    method: string;
    params: unknown;
  }
  | {
    kind: "LspNotification";
    workspace_id: WorkspaceId;
    file_id: FileId;
    method: string;
    params: unknown;
  }
  | {
    kind: "Ping";
  };

export type ServerMessage =
  | {
    kind: "Hello";
    client_id: ClientId;
  }
  | {
    kind: "DocSync";
    workspace_id: WorkspaceId;
    file_id: FileId;
    update: Uint8Array;
  }
  | {
    kind: "DocUpdate";
    workspace_id: WorkspaceId;
    file_id: FileId;
    update: Uint8Array;
    origin: ClientId;
  }
  | {
    kind: "Awareness";
    workspace_id: WorkspaceId;
    file_id: FileId;
    client_id: ClientId;
    payload: Uint8Array;
  }
  | {
    kind: "Awarenessleave";
    workspace_id: WorkspaceId;
    file_id: FileId;
    client_id: ClientId;
  }
  | {
    kind: "TerminalOutput";
    term_id: TerminalId;
    data: Uint8Array;
  }
  | {
    kind: "TerminalExit";
    term_id: TerminalId;
    code: number;
  }
  | {
    kind: "LspResponse";
    request_id: string;
    result: unknown;
  }
  | {
    kind: "LspError";
    request_id: string;
    message: string;
  }
  | {
    kind: "Diagnostics";
    workspace_id: WorkspaceId;
    file_id: FileId;
    diagnostics: LspDiagnostic[];
  }
  | {
    kind: "Error";
    context?: string;
    code: ErrorCode;
    message: string;
  }
  | {
    kind: "Pong";
  };

export interface LspDiagnostic {
  range: LspRange,
  severity: DiagnosticSeverity,
  message: string,
  source?: string,
  code: DiagnosticCode,
  tags: DiagnosticTag[],
  related_information: RelatedInfo[],
}

type DiagnosticCode = number | string;

interface LspRange {
  start: LspPosition,
  end: LspPosition,
}

interface LspPosition {
  line: number,
  character: number,
}

enum DiagnosticSeverity {
  Error = 1,
  Warning = 2,
  Information = 3,
  Hint = 4,
}

enum DiagnosticTag {
  Unnecessary = 1,
  Deprecated = 2,
}

interface RelatedInfo {
  location_uri: string,
  range: LspRange,
  message: string,
}