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
import { infoPanelExtension } from "./plugin/infoPanel";
import { ColorScheme, Theme, themeExtension } from "./plugin/theme";

export const LSP_INIT_PARAMS = (base: string): InitializeParams => ({
  processId: null,
  rootUri: `file:///${base}`,
  capabilities: {
    textDocument: {
      // codeAction: {
      //   dynamicRegistration: true, // lol, i propbably don't
      //   codeActionLiteralSupport: {
      //     codeActionKind: {
      //       // valueSet:
      //     },
      //   },
      //   isPreferredSupport: true, // Seems easy enough
      //   disabledSupport: true, // Seems easy enough
      //   dataSupport: false, // uhhmm, maybe not for now. We should support the older configuration first
      //   resolveSupport: {
      //     properties: [], // What values do i put here?
      //   },
      //   honorsChangeAnnotations: false, // Not sure if i want to sign up for this yet.
      // },
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
        // This seems to just be basic support, I think there is a fancier one avaliable
        dynamicRegistration: true,
        completionItem: {
          snippetSupport: true,
          commitCharactersSupport: true,
          documentationFormat: ["plaintext", "markdown"],
          deprecatedSupport: true, // I want to support this, how can i?
          preselectSupport: true, // What is this
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

export const DefaultTheme = Facet.define<Theme, Theme>({
  combine: (c) => c[0] || null,
});
export const DefaultColorScheme = Facet.define<ColorScheme, ColorScheme>({
  combine: (c) => c[0] || null,
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
  theme: Theme = "gruvbox",
  color: ColorScheme = "dark",
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
    DefaultTheme.of(theme),
    DefaultColorScheme.of(color),
    DocumentVersion.of(version),
    LspClient.of(new LanguageServerClient(sendRequest, sendNotification)),
    themeExtension(theme, color),
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
    infoPanelExtension(),
  ];
}
