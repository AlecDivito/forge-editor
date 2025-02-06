import { SendRequest } from "@/hooks/use-send-message";
import { hoverTooltip } from "@codemirror/view";
import { Extension, Facet, StateEffect } from "@uiw/react-codemirror";
import { InitializeParams, InitializeResult } from "vscode-languageserver-protocol";
import { LanguageServerClient } from "./client";
import { autocompletion } from "@codemirror/autocomplete";
import { autoCompletionOverride } from "./autocomplete";
import { requestHoverToolTip } from "./hover";
import { SendLspNotification } from "@/hooks/use-send-notification";
import { ForgeLspExtension } from "./view";
import { linterExtension } from "./linter";

export const LSP_INIT_PARAMS = (base: string): InitializeParams => ({
  processId: null,
  rootUri: `file:///${base}`,
  capabilities: {
    textDocument: {
      publishDiagnostics: {
        relatedInformation: true,
        versionSupport: true,
        codeDescriptionSupport: true,
        dataSupport: true,
      },
      hover: {
        dynamicRegistration: true,
        contentFormat: ["plaintext", "markdown"],
      },
      moniker: {}, // What is this?
      synchronization: {
        dynamicRegistration: true, // What is dynamicRegistration
        willSave: false,
        didSave: false, // Hmm, we don't support saving, interesting
        willSaveWaitUntil: false, // definitively false
      },
      completion: {
        dynamicRegistration: true,
        completionItem: {
          snippetSupport: true,
          commitCharactersSupport: true,
          documentationFormat: ["plaintext", "markdown"],
          deprecatedSupport: true, // I want to support this, how can i?
          preselectSupport: false, // What is this
        },
        contextSupport: true, // Whats the additional context?
      },
      signatureHelp: {
        dynamicRegistration: true,
        signatureInformation: {
          documentationFormat: ["plaintext", "markdown"],
          parameterInformation: {
            labelOffsetSupport: true,
          },
          activeParameterSupport: true,
        },
        contextSupport: true,
      },
      declaration: {
        dynamicRegistration: true,
        linkSupport: true,
      },
      definition: {
        dynamicRegistration: true,
        linkSupport: true,
      },
      typeDefinition: {
        dynamicRegistration: true,
        linkSupport: true,
      },
      implementation: {
        dynamicRegistration: true,
        linkSupport: true,
      },
    },
    workspace: {
      workspaceFolders: true,
    },
  },
  initializationOptions: null,
  workspaceFolders: [
    {
      uri: `file:///${base}`,
      name: "demo",
    },
  ],
});

export const LspClient = Facet.define<LanguageServerClient, LanguageServerClient>({
  combine: (c) => c[0] || null,
});

export const Capabilities = Facet.define<InitializeResult, InitializeResult>({
  combine: (c) => c[0] || null,
});
export const DocumentUri = Facet.define<string, string>({
  combine: (c) => c[0] || "",
});
export const DocumentVersion = Facet.define<number, number>({
  combine: (c) => c[0] || 0,
});
export const Language = Facet.define<string, string>({
  combine: (c) => c[0] || "",
});
export const ChangesEffect = StateEffect.define<never[]>();

export function lspExtensions(
  sendRequest: SendRequest,
  sendNotification: SendLspNotification,
  documentUri: string,
  language: string,
  version: number,
  capabilities: InitializeResult,
): Extension[] {
  const tooltipExtension = hoverTooltip(requestHoverToolTip, {
    hideOn: (tr, tooltip) => {
      return false;
    },
    hideOnChange: false,
    hoverTime: 200,
  });

  return [
    Capabilities.of(capabilities),
    DocumentUri.of(documentUri),
    Language.of(language),
    DocumentVersion.of(version),
    LspClient.of(new LanguageServerClient(sendRequest, sendNotification)),
    ForgeLspExtension(),
    tooltipExtension,
    autocompletion({
      activateOnTyping: true,
      activateOnTypingDelay: 100,
      selectOnOpen: true,
      closeOnBlur: false,
      maxRenderedOptions: 200,
      // add to the completion dialog element.
      // This is the popup that appears on the page. It's the entire box
      tooltipClass: (state) => {
        // console.log(state);
        return "tooltipClass";
      },
      // Add CSS classes to completion options
      optionClass: (completion) => {
        // console.log(completion);
        return "completion";
      },
      filterStrict: true,
      icons: true,
      activateOnCompletion: (test) => {
        // console.log(test);
        return true;
      },
      override: [autoCompletionOverride],
    }),
    linterExtension(),
  ];
}
