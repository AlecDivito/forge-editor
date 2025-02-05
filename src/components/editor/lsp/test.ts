import {
  EditorView,
  PluginValue,
  showTooltip,
  StateEffect,
  StateField,
  Tooltip,
  Transaction,
  ViewPlugin,
  ViewUpdate,
} from "@uiw/react-codemirror";
import { Capabilities, DocumentUri, LspClient } from ".";
import { LanguageServerClient } from "./client";
import { formatContents } from "./htmlFormatter";
import { InitializeResult } from "vscode-languageserver-protocol";

const toolTipsEffect = StateEffect.define<Tooltip[]>();

const signatureHelpTooltip = StateField.define<readonly Tooltip[]>({
  create: () => [],

  update(tooltips, tr: Transaction) {
    tooltips = [];

    for (const effect of tr.effects) {
      if (effect.is(toolTipsEffect)) {
        tooltips = effect.value;
      }
    }

    return tooltips;
  },

  provide: (f) => showTooltip.from(f, (value) => value[0]),
});

class SignatureHelpTooltipLoader implements PluginValue {
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
          this.view.dispatch({ effects: toolTipsEffect.of([]) });
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

        this.view.dispatch({ effects: toolTipsEffect.of(tooltips) });
      })
      .catch((err) => {
        console.error("Signature help request failed:", err);
        this.updateInProgress = false;
      });
  }
}

const signatureHelpPlugin = ViewPlugin.define((view) => new SignatureHelpTooltipLoader(view));

// Function to enable the extension
export function signatureHelpExtension(capabilities: InitializeResult) {
  if (capabilities?.capabilities?.signatureHelpProvider) {
    return [signatureHelpPlugin, signatureHelpTooltip];
  }
  return [];
}
