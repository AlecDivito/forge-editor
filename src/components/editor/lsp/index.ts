import { SendLspMessage } from "@/hooks/use-send-message";
import {
  Extension,
  Facet,
  hoverTooltip,
  StateEffect,
  ViewPlugin,
} from "@uiw/react-codemirror";
import {
  InitializeParams,
  InitializeResult,
} from "vscode-languageserver-protocol";
import { LanguageServerClient } from "./client";
import { LSPInitializer } from "./view";
import { autocompletion } from "@codemirror/autocomplete";
import { autoCompletionOverride } from "./autocomplete";
import { requestHoverToolTip } from "./hover";

export const LSP_INIT_PARAMS = (base: string): InitializeParams => ({
  processId: null,
  rootUri: `file:///${base}`,
  capabilities: {
    textDocument: {
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
        },
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

export const LspClient = Facet.define<
  LanguageServerClient,
  LanguageServerClient
>({
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
  sender: SendLspMessage,
  documentUri: string,
  language: string,
  version: number,
  capabilities: InitializeResult
): Extension[] {
  return [
    Capabilities.of(capabilities),
    DocumentUri.of(documentUri),
    Language.of(language),
    DocumentVersion.of(version),
    LspClient.of(new LanguageServerClient(sender)),
    ViewPlugin.define((view) => new LSPInitializer(view)),
    hoverTooltip(requestHoverToolTip),
    autocompletion({
      override: [autoCompletionOverride],
    }),
    // linter(languageLinter),
  ];
}
