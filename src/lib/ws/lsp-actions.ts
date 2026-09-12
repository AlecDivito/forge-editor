import { WorkspaceId, FileId } from "@/lib/ws/messages";
import type { Diagnostic, Position, Range } from "vscode-languageserver-protocol";
import { sendDocumentLspRequest, sendWorkspaceLspRequest } from "./lsp-client";

export function goToDefinition(workspaceId: WorkspaceId, fileId: FileId, position: Position) {
  return sendDocumentLspRequest(workspaceId, fileId, "textDocument/definition", { position });
}

export function findReferences(
  workspaceId: WorkspaceId,
  fileId: FileId,
  position: Position,
  includeDeclaration = true,
) {
  return sendDocumentLspRequest(workspaceId, fileId, "textDocument/references", {
    position,
    context: { includeDeclaration },
  });
}

export function documentSymbols(workspaceId: WorkspaceId, fileId: FileId, signal?: AbortSignal) {
  return sendDocumentLspRequest(workspaceId, fileId, "textDocument/documentSymbol", {}, signal);
}

export function workspaceSymbols(workspaceId: WorkspaceId, query: string, signal?: AbortSignal) {
  return sendWorkspaceLspRequest(workspaceId, "workspace/symbol", { query }, signal);
}

export function codeActions(
  workspaceId: WorkspaceId,
  fileId: FileId,
  range: Range,
  diagnostics: Diagnostic[],
) {
  return sendDocumentLspRequest(workspaceId, fileId, "textDocument/codeAction", {
    range,
    context: { diagnostics },
  });
}

export function renameSymbol(workspaceId: WorkspaceId, fileId: FileId, position: Position, newName: string) {
  return sendDocumentLspRequest(workspaceId, fileId, "textDocument/rename", { position, newName });
}

export function formatDocument(workspaceId: WorkspaceId, fileId: FileId) {
  return sendDocumentLspRequest(workspaceId, fileId, "textDocument/formatting", {
    options: { tabSize: 2, insertSpaces: true },
  });
}
