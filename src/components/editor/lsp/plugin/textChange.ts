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

    console.log(changes);
    // This is meant to be a notification
    this.sender.didChange({
      textDocument: {
        uri: this.documentUri,
        version: ++this.documentVersion,
      },
      contentChanges: changes,
    });
  }

  private convertChangeDescToContentChangeEvent(update: ViewUpdate): TextDocumentContentChangeEvent[] {
    const lspChanges: TextDocumentContentChangeEvent[] = [];
    let currentDoc = update.startState.doc; // Track document state as a Text instance
    const shiftMap = new Map<number, number>(); // Maps positions to cumulative shifts

    update.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
      // Compute adjusted positions based on previous shifts
      const adjustedFromA = fromA + (shiftMap.get(fromA) || 0);
      const adjustedToA = toA + (shiftMap.get(toA) || 0);

      // Compute start and end positions in the current document
      const startLine = currentDoc.lineAt(adjustedFromA);
      const endLine = currentDoc.lineAt(adjustedToA);

      // Create LSP change event
      lspChanges.push({
        range: {
          start: {
            line: startLine.number - 1,
            character: adjustedFromA - startLine.from,
          },
          end: {
            line: endLine.number - 1,
            character: adjustedToA - endLine.from,
          },
        },
        text: inserted.toString(),
      });

      // Calculate position shift caused by this change
      const lengthBefore = adjustedToA - adjustedFromA;
      const lengthAfter = inserted.length;
      const shift = lengthAfter - lengthBefore;

      // Update shiftMap for all future positions beyond this change
      for (let i = adjustedToA; i <= currentDoc.length; i++) {
        shiftMap.set(i, (shiftMap.get(i) || 0) + shift);
      }

      // Apply change to document state
      currentDoc = currentDoc.replace(adjustedFromA, adjustedToA, inserted);
    }, false); // Ensure sequential processing

    return lspChanges;
  }

  destory(): void {}
}

export function textChangeExtension(): Extension[] {
  return [];
}
