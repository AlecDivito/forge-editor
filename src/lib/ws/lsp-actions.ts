import { WorkspaceId, FileId } from "@/lib/ws/messages";
import type { Diagnostic, Position, Range } from "vscode-languageserver-protocol";
import { sendLspRequest } from "./lsp-client";

export function goToDefinition(workspaceId: WorkspaceId, fileId: FileId, position: Position) {
  return sendLspRequest(workspaceId, fileId, "textDocument/definition", { position });
}

export function findReferences(
  workspaceId: WorkspaceId,
  fileId: FileId,
  position: Position,
  includeDeclaration = true,
) {
  return sendLspRequest(workspaceId, fileId, "textDocument/references", {
    position,
    context: { includeDeclaration },
  });
}

export function documentSymbols(workspaceId: WorkspaceId, fileId: FileId) {
  return sendLspRequest(workspaceId, fileId, "textDocument/documentSymbol", {});
}

export function workspaceSymbols(workspaceId: WorkspaceId, fileId: FileId, query: string) {
  // fileId here is a placeholder — see the messages.ts note on making
  // file_id optional for workspace-scoped methods.
  return sendLspRequest(workspaceId, fileId, "workspace/symbol", { query });
}

export function codeActions(
  workspaceId: WorkspaceId,
  fileId: FileId,
  range: Range,
  diagnostics: Diagnostic[],
) {
  return sendLspRequest(workspaceId, fileId, "textDocument/codeAction", {
    range,
    context: { diagnostics },
  });
}

export function renameSymbol(workspaceId: WorkspaceId, fileId: FileId, position: Position, newName: string) {
  return sendLspRequest(workspaceId, fileId, "textDocument/rename", { position, newName });
}

export function formatDocument(workspaceId: WorkspaceId, fileId: FileId) {
  return sendLspRequest(workspaceId, fileId, "textDocument/formatting", {
    options: { tabSize: 2, insertSpaces: true },
  });
}