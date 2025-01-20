import DiffMatchPatch from "diff-match-patch";
import {
  Capabilities,
  DocumentUri,
  DocumentVersion,
  Language,
  LspClient,
} from ".";
import { EditorView, PluginValue, ViewUpdate } from "@uiw/react-codemirror";
import { LanguageServerClient } from "./client";
import {
  InitializeResult,
  TextDocumentContentChangeEvent,
  TextDocumentSyncKind,
} from "vscode-languageserver-protocol";

export class LSPInitializer implements PluginValue {
  capabilities: InitializeResult;
  textSyncKind: TextDocumentSyncKind;

  changes: TextDocumentContentChangeEvent[];
  sender: LanguageServerClient;
  documentUri: string;
  language: string;
  dmp: DiffMatchPatch;
  documentVersion: number;

  timer?: NodeJS.Timeout;
  debounceTime: number;

  constructor(view: EditorView) {
    this.dmp = new DiffMatchPatch();
    this.capabilities = view.state.facet(Capabilities);
    this.sender = view.state.facet(LspClient);
    this.documentUri = view.state.facet(DocumentUri);
    this.language = view.state.facet(Language);
    this.documentVersion = view.state.facet(DocumentVersion);
    // this.documentVersion = view.state.facet(DocumentVersion);
    this.changes = [];

    // The initialize and open event are called by different processes. It's assumed
    // that once this extension is called, the LSP is already initialized, has
    // all the files in it's working directory and knows that the current file
    // is open.

    // For convince in the result of the class, we will do some post processing
    // of the LSP capabilities here.
    this.textSyncKind = TextDocumentSyncKind.None;
    if (this.capabilities.capabilities.textDocumentSync) {
      const sync = this.capabilities.capabilities.textDocumentSync;
      if (typeof sync === "number") {
        this.textSyncKind = sync;
      } else {
        this.textSyncKind = sync.change || TextDocumentSyncKind.None;
      }
    }
    this.textSyncKind = TextDocumentSyncKind.Full;

    // Finally, set some sensible defaults
    this.timer = undefined;
    this.debounceTime = 0;
  }

  update(update: ViewUpdate): void {
    if (!update.docChanged || this.textSyncKind === TextDocumentSyncKind.None)
      return;

    if (this.textSyncKind === TextDocumentSyncKind.Incremental) {
      const changes = this.convertChangeDescToContentChangeEvent(update);
      if (changes.length > 0) {
        this.changes.push(...changes);
      }
    }

    this.scheduleSend(update);
  }

  destroy() {
    // Cleanup logic if needed
  }

  private convertChangeDescToContentChangeEvent(
    update: ViewUpdate
  ): TextDocumentContentChangeEvent[] {
    const lspChanges: TextDocumentContentChangeEvent[] = [];

    update.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
      // Get start line information
      const startLine = update.state.doc.lineAt(fromA);

      let endLine;
      if (toA >= update.state.doc.length) {
        // Handle edge case: toA exceeds document length (e.g., last character deletion)
        endLine = startLine; // Use start line if deletion extends beyond the document
      } else {
        endLine = update.state.doc.lineAt(toA);
      }

      lspChanges.push({
        range: {
          start: {
            line: startLine.number - 1,
            character: fromA - startLine.from,
          },
          end: {
            line: endLine.number - 1,
            character: toA - endLine.from,
          },
        },
        text: inserted.toString(),
      });
    }, true);

    return lspChanges;
  }

  private scheduleSend(update: ViewUpdate) {
    clearTimeout(this.timer);

    this.timer = setTimeout(() => {
      let contentChanges = this.changes;
      if (this.textSyncKind === TextDocumentSyncKind.Full) {
        contentChanges = [
          {
            text: update.state.doc.toString(),
          },
        ];
      }

      this.sender.didChange({
        textDocument: {
          uri: this.documentUri,
          version: ++this.documentVersion,
        },
        contentChanges,
      });

      this.changes = [];
    }, this.debounceTime);
  }
}
