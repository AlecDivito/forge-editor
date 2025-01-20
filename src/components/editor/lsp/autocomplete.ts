import { CompletionTriggerKind } from "vscode-languageserver-protocol";
import { CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { Capabilities, DocumentUri, LspClient } from ".";

export const autoCompletionOverride = async (
  context: CompletionContext
): Promise<CompletionResult | null> => {
  const uri = context.state.facet(DocumentUri);
  const capabilities = context.state.facet(Capabilities);
  const sender = context.state.facet(LspClient);

  const { state, pos, explicit } = context;
  const line = state.doc.lineAt(pos);
  let triggerKind: CompletionTriggerKind = CompletionTriggerKind.Invoked;
  let triggerCharacter: string | undefined;
  if (
    !explicit &&
    capabilities.capabilities?.completionProvider?.triggerCharacters?.includes(
      line.text[pos - line.from - 1]
    )
  ) {
    triggerKind = CompletionTriggerKind.TriggerCharacter;
    triggerCharacter = line.text[pos - line.from - 1];
  }
  if (
    triggerKind === CompletionTriggerKind.Invoked &&
    !context.matchBefore(/\w+$/)
  ) {
    return null;
  }

  // TODO: (Alec) Send document changes

  const result = sender.completion({
    textDocument: { uri },
    position: {
      line: line.number,
      character: pos - line.from,
    },
    context: {
      triggerKind,
      triggerCharacter,
    },
  });

  console.log(result);

  return null;
};
