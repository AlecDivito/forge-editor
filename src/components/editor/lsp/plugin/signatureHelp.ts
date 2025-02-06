import {
  EditorView,
  showTooltip,
  StateEffect,
  StateField,
  Tooltip,
  Transaction,
  ViewUpdate,
} from "@uiw/react-codemirror";
import { InitializeResult, MarkupContent } from "vscode-languageserver-protocol";
import { ForgePlugin } from ".";
import { LanguageServerClient } from "../client";
import { Capabilities, DocumentUri, LspClient } from "..";
import { formatContents } from "../htmlFormatter";
import { SuccessfulServerLspResponse } from "@/service/lsp";
import { syntaxTree } from "@codemirror/language";
import { SyntaxNode } from "@lezer/common";

export const toolTipsEffect = StateEffect.define<Tooltip[]>();

const hasParentNodeOf = (nodeName: string, tree?: SyntaxNode): SyntaxNode | undefined => {
  let node = tree;
  while (node) {
    if (node.type.name === nodeName) {
      return node;
    }
    node = node.parent ?? undefined;
  }
  return undefined;
};

const signatureHelpTooltip = StateField.define<readonly Tooltip[]>({
  create: () => [],

  update(tooltips, tr: Transaction) {
    const pos = tr.state.selection.main.head;
    const tree = syntaxTree(tr.state).resolveInner(pos);
    const result = hasParentNodeOf("ArgList", tree);
    if (!result) {
      return [];
    }

    for (const effect of tr.effects) {
      if (effect && effect.is(toolTipsEffect)) {
        tooltips = effect.value;
      }
    }

    return tooltips;
  },

  provide: (f) => showTooltip.from(f, (value) => value[0]),
});

export class SignatureHelpTooltipPlugin extends ForgePlugin {
  updateInProgress = false;
  capabilities?: InitializeResult<unknown>;
  sender: LanguageServerClient;
  uri: string;

  constructor(private view: EditorView) {
    super();
    this.sender = view.state.facet(LspClient);
    this.uri = view.state.facet(DocumentUri);
    this.capabilities = view.state.facet(Capabilities);
  }

  isEnabled(): boolean {
    return !!this.capabilities?.capabilities?.signatureHelpProvider && !this.updateInProgress;
  }

  update(update: ViewUpdate) {
    if (!update.selectionSet && !update.docChanged) {
      return;
    }

    const pos = this.view.state.selection.main.head;
    const help = this.capabilities!.capabilities!.signatureHelpProvider!;
    const triggerCharacters = new Set(help.triggerCharacters ?? []);
    const retriggerCharacters = new Set(help.retriggerCharacters ?? []);

    const charBeforeCursor = pos > 0 ? this.view.state.sliceDoc(pos - 1, pos) : "";
    if (!triggerCharacters.has(charBeforeCursor) && !retriggerCharacters.has(charBeforeCursor)) {
      return;
    }

    if (this.updateInProgress) {
      return;
    }
    this.updateInProgress = true;

    const response = this.sender.signatureHelp({
      textDocument: { uri: this.uri },
      position: {
        line: this.view.state.doc.lineAt(pos).number - 1,
        character: pos - this.view.state.doc.lineAt(pos).from,
      },
    });

    this.processResponse(pos, response);
  }

  private async processResponse(pos: number, promise: Promise<SuccessfulServerLspResponse>) {
    try {
      const response = await promise;
      this.updateInProgress = false;

      if (!response || response.method !== "textDocument/signatureHelp" || response.result === null) {
        return;
      }

      const { signatures, activeSignature, activeParameter } = response.result;
      if (signatures.length === 0) {
        return;
      }

      const active = activeSignature ?? 0;
      const signaturedocumentation = signatures[active]?.documentation;
      let signatureText = signatures[active].label;
      let parameterDocumentation: string | MarkupContent | undefined = undefined;

      if (typeof activeParameter === "number") {
        if (signatures[active]?.parameters?.[activeParameter]) {
          const parameter = signatures[active].parameters[activeParameter];
          const replacement = `<strong style="color: lightblue">${parameter.label}</strong>`;
          if (Array.isArray(parameter.label)) {
            signatureText =
              signatureText.substring(0, parameter.label[0]) +
              replacement +
              signatureText.substring(parameter.label[1]);
          } else {
            signatureText = signatureText.replace(parameter.label, replacement);
          }
          parameterDocumentation = parameter.documentation;
        }
      }

      const dom = document.createElement("div");
      const labelDom = document.createElement("div");
      labelDom.innerHTML = await formatContents(signatureText);
      dom.appendChild(labelDom);

      if (parameterDocumentation) {
        const documentationDom = document.createElement("div");
        documentationDom.setAttribute("style", "border-top: 1px solid black");
        documentationDom.innerHTML = await formatContents(parameterDocumentation);
        dom.appendChild(documentationDom);
      }

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
    } catch (err) {
      console.error("Signature help request failed:", err);
      this.updateInProgress = false;
      this.view.dispatch({ effects: toolTipsEffect.of([]) });
    }
  }
}

export function signatureHelpExtension() {
  return [signatureHelpTooltip];
}
