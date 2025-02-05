import { EditorView, showTooltip, Tooltip, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { Capabilities, DocumentUri, LspClient } from ".";
import { InitializeResult } from "vscode-languageserver-protocol";
import { PluginValue, StateEffect, StateField, Transaction } from "@uiw/react-codemirror";
import { formatContents } from "./htmlFormatter";
import { LanguageServerClient } from "./client";

const updateFollowedCursor = StateEffect.define<Cursor | null>({
  map: (value, changes) => {
    console.log(value);
    return value.map(changes);
  },
});

const followedCursor = StateField.define<Cursor | null>({
  create: () => null,
  update: (value, tr) => {
    let updated = false;
    for (const effect of tr.effects) {
      if (effect.is(updateFollowedCursor)) {
        value = effect.value;
        updated = true;
      }
    }
    if (!updated && value && tr.docChanged) {
      value = value.map(tr.changes);
    }

    return value;
  },
});

const updateSignatureHelpEffect = StateEffect.define<readonly Tooltip[]>();

const signatureHelpStateField = StateField.define<readonly Tooltip[]>({
  create: () => [],

  update(tooltips, tr: Transaction) {
    for (const effect of tr.effects) {
      if (effect.is(updateSignatureHelpEffect)) {
        return effect.value;
      }
    }
    return tooltips;
  },

  provide: (f) => showTooltip.computeN([f], (state) => state.field(f)),
});

// ViewPlugin to fetch and update tooltips
class SignatureHelpTooltip implements PluginValue {
  updateInProgress = false;
  sender: LanguageServerClient;
  uri: string;
  triggerCharacters: Set<string>;
  retriggerCharacters: Set<string>;

  constructor(private view: EditorView) {
    this.sender = view.state.facet(LspClient);
    this.uri = view.state.facet(DocumentUri);
    const capabilities = view.state.facet(Capabilities);
    const help = capabilities!.capabilities!.signatureHelpProvider!;
    this.triggerCharacters = new Set(help.triggerCharacters ?? []);
    this.retriggerCharacters = new Set(help.retriggerCharacters ?? []);
  }

  update(update: ViewUpdate) {
    if (!update.selectionSet && !update.docChanged) return;

    const pos = this.view.state.selection.main.head;

    const charBeforeCursor = pos > 0 ? this.view.state.sliceDoc(pos - 1, pos) : "";
    if (!this.triggerCharacters.has(charBeforeCursor) && !this.retriggerCharacters.has(charBeforeCursor)) {
      // this.view.dispatch({ effects: updateSignatureHelpEffect.of([]) });
      return;
    }

    if (this.updateInProgress) return;
    this.updateInProgress = true;

    this.sender
      .signatureHelp({
        textDocument: { uri: this.uri },
        position: {
          line: this.view.state.doc.lineAt(pos).number - 1,
          character: pos - this.view.state.doc.lineAt(pos).from,
        },
      })
      .then(async (response) => {
        this.updateInProgress = false;

        if (!response || response.method !== "textDocument/signatureHelp" || response.result === null) {
          // this.view.dispatch({ effects: updateSignatureHelpEffect.of([]) });
          return;
        }

        const { signatures, activeSignature } = response.result;
        if (signatures.length === 0) {
          this.view.dispatch({ effects: updateSignatureHelpEffect.of([]) });
          return;
        }

        console.log(signatures);
        const signatureText = signatures[activeSignature ?? 0].label;
        const signaturedocumentation = signatures[activeSignature ?? 0]?.documentation;
        // const parameters = signatures[activeSignature ?? 0]?.pa

        const dom = document.createElement("div");
        const labelDom = document.createElement("div");
        labelDom.innerHTML = await formatContents(signatureText);
        dom.appendChild(labelDom);
        if (signaturedocumentation) {
          const documentationDom = document.createElement("div");
          documentationDom.setAttribute("style", "border-top: 1px solid black");
          documentationDom.innerHTML = await formatContents(signaturedocumentation);
          dom.appendChild(documentationDom);
        }

        const tooltips: Tooltip[] = [
          {
            pos,
            above: true,
            arrow: true,
            create: () => {
              return { dom };
            },
          },
        ];

        this.view.dispatch({ effects: updateSignatureHelpEffect.of(tooltips) });
      })
      .catch((err) => {
        console.error("Signature help request failed:", err);
        this.updateInProgress = false;
      });
  }

  destroy() {}
}

// ViewPlugin that triggers the tooltip update
const signatureHelpPlugin = ViewPlugin.define((view) => new SignatureHelpTooltip(view));

// Function to enable the extension
export function signatureHelpExtension(capabilities: InitializeResult) {
  if (capabilities?.capabilities?.signatureHelpProvider) {
    return [signatureHelpPlugin, signatureHelpStateField];
  }
  return [];
}
