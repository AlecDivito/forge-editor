import { CompletionItemKind, CompletionTriggerKind, MarkedString, MarkupContent } from "vscode-languageserver-protocol";
import { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
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

function toSet(chars: Set<string>) {
  let preamble = "";
  let flat = Array.from(chars).join("");
  const words = /\w/.test(flat);
  if (words) {
    preamble += "\\w";
    flat = flat.replace(/\w/g, "");
  }
  return `[${preamble}${flat.replace(/[^\w\s]/g, "\\$&")}]`;
}

function prefixMatch(options: Completion[]) {
  const first = new Set<string>();
  const rest = new Set<string>();

  for (const { apply } of options) {
    const [initial, ...restStr] = apply as string;
    first.add(initial);
    for (const char of restStr) {
      rest.add(char);
    }
  }

  const source = toSet(first) + toSet(rest) + "*$";
  return [new RegExp("^" + source), new RegExp(source)];
}

export const autoCompletionOverride = async (context: CompletionContext): Promise<CompletionResult | null> => {
  const uri = context.state.facet(DocumentUri);
  const capabilities = context.state.facet(Capabilities);
  const sender = context.state.facet(LspClient);

  console.log("triggered");

  const { state, pos, explicit } = context;
  const line = state.doc.lineAt(pos);
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

  let options = items.map(({ detail, label, kind, textEdit, documentation, sortText, filterText }) => {
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
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [span, match] = prefixMatch(options);
  const token = context.matchBefore(match);

  if (token) {
    const word = token.text.toLowerCase();
    if (/^\w+$/.test(word)) {
      options = options
        .filter(({ filterText }) => filterText.toLowerCase().startsWith(word))
        .sort(({ apply: a }, { apply: b }) => {
          switch (true) {
            case a.startsWith(token.text) && !b.startsWith(token.text):
              return -1;
            case !a.startsWith(token.text) && b.startsWith(token.text):
              return 1;
          }
          return 0;
        });
    }
  }

  return {
    from: context.pos,
    options,
  };
};
