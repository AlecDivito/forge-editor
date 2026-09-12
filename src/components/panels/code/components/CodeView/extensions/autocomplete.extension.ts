import { CompletionItemKind, CompletionTriggerKind, MarkedString, MarkupContent } from "vscode-languageserver-protocol";
import { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { DocumentFileId, DocumentWorkspaceId } from "./state.extension";
import { sendLspRequest } from "@/lib/ws/lsp-client";

const CompletionItemKindMap = Object.fromEntries(
    Object.entries(CompletionItemKind).map(([key, value]) => [value, key]),
) as Record<CompletionItemKind, string>;

function formatContents(contents: MarkupContent | MarkedString | MarkedString[]): string {
    if (Array.isArray(contents)) {
        return contents.map(formatContents).join("\n\n");
    }
    return typeof contents === "string" ? contents : contents.value;
}

// Whatever the language server actually declared as its own trigger
// characters (".", from your rust/ts capabilities negotiation) — used to
// decide whether this invocation is a real trigger-character completion
// or just "user is typing a word." Extend per-language if you wire up
// more servers with different trigger sets.
const KNOWN_TRIGGER_CHARACTERS = new Set([".", "\"", "'", "/", "@", "<"]);

export const autoCompletionOverride = async (context: CompletionContext): Promise<CompletionResult | null> => {
    const workspaceId = context.state.facet(DocumentWorkspaceId);
    const fileId = context.state.facet(DocumentFileId);
    if (!workspaceId || !fileId) return null;
    // TODO: Add in actual capabilities check for how to handle this.

    const { state, pos, explicit } = context;
    const line = state.doc.lineAt(pos);
    const charBefore = line.text[pos - line.from - 1];

    let triggerKind: CompletionTriggerKind = CompletionTriggerKind.Invoked;
    let triggerCharacter: string | undefined;

    if (!explicit && charBefore && KNOWN_TRIGGER_CHARACTERS.has(charBefore)) {
        triggerKind = CompletionTriggerKind.TriggerCharacter;
        triggerCharacter = charBefore;
    } else if (triggerKind === CompletionTriggerKind.Invoked && !context.matchBefore(/\w+$/)) {
        // Not explicit, not a known trigger character, and no word typed yet
        // — nothing worth asking the server about.
        return null;
    }

    let response;
    try {
        response = await sendLspRequest(workspaceId, fileId, "textDocument/completion", {
            position: {
                line: line.number - 1, // LSP lines are 0-indexed; CodeMirror's are 1-indexed
                character: pos - line.from,
            },
            context: {
                triggerKind,
                triggerCharacter,
            },
        });
    } catch {
        return null; // no completion provider, request timed out, or LSP not attached yet
    }

    if (!response) return null;

    const items = "items" in response ? response.items : response;
    if (!Array.isArray(items)) return null;

    const options: (Completion & { filterText: string })[] = items.map(
        ({ detail, label, kind, textEdit, documentation, sortText, filterText }) => {
            const completion: Completion & { filterText: string; sortText?: string } = {
                label,
                detail,
                apply: textEdit?.newText ?? label,
                type: kind && CompletionItemKindMap[kind]?.toLowerCase(),
                sortText: sortText ?? label,
                filterText: filterText ?? label,
            };
            if (documentation) {
                completion.info = () => {
                    const dom = document.createElement("div");
(documentation);
                    return dom;
                };
            }
            return completion;
        },
    );

    const token = context.matchBefore(/\w*$/);
    return {
        filter: false, // trust filterText matching below over CodeMirror's default fuzzy filter
        from: token ? token.from : context.pos,
        options: token?.text
            ? options.filter(({ filterText }) => filterText.toLowerCase().startsWith(token.text.toLowerCase()))
            : options,
    };
};
