import { EditorView, ViewUpdate } from "@codemirror/view";
import { Deferred, ForgePlugin } from ".";
import { LanguageServerClient } from "../client";
import { Capabilities, DocumentUri, DocumentVersion, Language, LspClient } from "..";
import { Extension, StateEffect } from "@uiw/react-codemirror";
import { InitializeResult, TextDocumentContentChangeEvent, TextDocumentSyncKind } from "vscode-languageserver-protocol";
import DiffMatchPatch from "diff-match-patch";

export const textChangeEffect = StateEffect.define<TextDocumentContentChangeEvent[]>();

export class TextChangePlugin extends ForgePlugin {
  capabilities: InitializeResult;
  textSyncKind: TextDocumentSyncKind;

  changes: TextDocumentContentChangeEvent[];
  sender: LanguageServerClient;
  documentUri: string;
  language: string;
  dmp: DiffMatchPatch;
  documentVersion: number;

  defered?: Deferred<StateEffect<TextDocumentContentChangeEvent[]>> = undefined;
  timer?: NodeJS.Timeout = undefined;
  debounceTime: number = 500;

  constructor(view: EditorView) {
    super();
    this.dmp = new DiffMatchPatch();
    this.capabilities = view.state.facet(Capabilities);
    this.sender = view.state.facet(LspClient);
    this.documentUri = view.state.facet(DocumentUri);
    this.language = view.state.facet(Language);
    this.documentVersion = view.state.facet(DocumentVersion);
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
  }

  isEnabled(): boolean {
    return this.textSyncKind !== TextDocumentSyncKind.None;
  }

  update(update: ViewUpdate) {
    if (!update.docChanged || this.textSyncKind === TextDocumentSyncKind.None) {
      return;
    }

    let changes = [];
    if (this.textSyncKind === TextDocumentSyncKind.Incremental) {
      changes = this.convertChangeDescToContentChangeEvent(update);
    } else if (this.textSyncKind === TextDocumentSyncKind.Full) {
      changes = [{ text: update.state.doc.toString() }];
    } else {
      throw new Error("Text document is supposed to be disabled");
    }

    // This is meant to be a notification
    this.sender.didChange({
      textDocument: {
        uri: this.documentUri,
        version: ++this.documentVersion,
      },
      contentChanges: changes,
    });

    // return this.scheduleSend();
  }

  private convertChangeDescToContentChangeEvent(update: ViewUpdate): TextDocumentContentChangeEvent[] {
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

  private scheduleSend() {
    if (!this.defered) {
      this.defered = new Deferred();
    }

    clearTimeout(this.timer);

    this.timer = setTimeout(async () => {
      const contentChanges = this.changes;

      this.sender.didChange({
        textDocument: {
          uri: this.documentUri,
          version: ++this.documentVersion,
        },
        contentChanges,
      });

      this.defered?.resolve?.(textChangeEffect.of(contentChanges));

      this.defered = undefined;
      this.changes = [];
    }, this.debounceTime);

    return this.defered.promise;
  }

  destory(): void {}
}

export function textChangeExtension(): Extension[] {
  return [];
}
