import { CompletionItemKind, CompletionTriggerKind, MarkedString, MarkupContent } from "vscode-languageserver-protocol";
import { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import { Capabilities, DocumentUri, LspClient } from ".";

const CompletionItemKindMap = Object.fromEntries(
  Object.entries(CompletionItemKind).map(([key, value]) => [value, key]),
) as Record<CompletionItemKind, string>;

function formatContents(contents: MarkupContent | MarkedString | MarkedString[]): string {
  if (Array.isArray(contents)) {
    return contents.map(formatContents).join("\n\n");
  }
  return typeof contents === "string" ? contents : contents.value;
}

export const autoCompletionOverride = async (context: CompletionContext): Promise<CompletionResult | null> => {
  const uri = context.state.facet(DocumentUri);
  const capabilities = context.state.facet(Capabilities);
  const sender = context.state.facet(LspClient);

  const { state, pos, explicit } = context;
  const line = state.doc.lineAt(pos);

  const tree = syntaxTree(state);
  let node = tree.resolveInner(pos, -1); // Get the nearest relevant node

  while (node && node.name === "PropertyName" && node.parent) {
    node = node.parent;
  }

  // console.log("AST Node:", node, node.parent?.name); // Debugging

  let triggerKind: CompletionTriggerKind = CompletionTriggerKind.Invoked;
  let triggerCharacter: string | undefined;

  if (
    !explicit &&
    capabilities.capabilities?.completionProvider?.triggerCharacters?.includes(line.text[pos - line.from - 1])
  ) {
    triggerKind = CompletionTriggerKind.TriggerCharacter;
    triggerCharacter = line.text[pos - line.from - 1];
  }
  if (triggerKind === CompletionTriggerKind.Invoked && !context.matchBefore(/\w+$/)) {
    return null;
  }

  const parent = node.parent?.name ?? node.name;

  // console.log("Parent Node:", parent); // Debugging

  // TODO: (Alec) Send document changes

  const response = await sender.completion({
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

  if (!response || response.method !== "textDocument/completion" || response.result === null) {
    return null;
  }

  const items = "items" in response.result ? response.result.items : (response.result ?? []);
  if (!Array.isArray(items)) {
    return null; // Ensure `items` is an array
  }

  let options = items
    .map(({ detail, label, kind, textEdit, documentation, sortText, filterText }) => {
      const completion: Completion & {
        filterText: string;
        sortText?: string;
        apply: string;
      } = {
        label,
        detail,
        apply: textEdit?.newText ?? label,
        type: kind && CompletionItemKindMap[kind].toLowerCase(),
        sortText: sortText ?? label,
        filterText: filterText ?? label,
      };
      if (documentation) {
        completion.info = formatContents(documentation);
      }
      return completion;
    })
    .filter(({ label }) => {
      // Filter only relevant completions for the parent node
      if (parent === "console") {
        return (
          label.startsWith("log") || label.startsWith("time") || label.startsWith("warn") || label.startsWith("error")
        );
      }
      return true; // Default to keeping all if no specific parent is found
    });

  const token = context.matchBefore(/\w*$/); // Match word characters before cursor
  if (token) {
    const prefix = token.text.toLowerCase();
    if (prefix) {
      options = options
        .filter(({ filterText }) => filterText.toLowerCase().startsWith(prefix)) // Only keep relevant completions
        .sort(({ apply: a }, { apply: b }) => {
          if (a.startsWith(prefix) && !b.startsWith(prefix)) return -1;
          if (!a.startsWith(prefix) && b.startsWith(prefix)) return 1;
          return 0;
        });
    }
  }

  return {
    filter: false,
    from: token ? token.from : context.pos,
    options,
  };
};
