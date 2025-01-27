import { EditorView, Text } from "@uiw/react-codemirror";
import { CompletionTriggerKind, Hover, HoverParams, MarkedString, MarkupContent } from "vscode-languageserver-protocol";
import { CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { Diagnostic } from "@codemirror/lint";

function offsetToPos(doc: Text, offset: number) {
  const line = doc.lineAt(offset);
  return {
    line: line.number - 1,
    character: offset - line.from,
  };
}

function posToOffset(doc: Text, pos: { line: number; character: number }) {
  if (pos.line >= doc.lines) return;
  const offset = doc.line(pos.line + 1).from + pos.character;
  if (offset > doc.length) return;
  return offset;
}

function formatContents(contents: MarkupContent | MarkedString | MarkedString[]): string {
  if (Array.isArray(contents)) {
    return contents.map((c) => formatContents(c) + "\n\n").join("");
  } else if (typeof contents === "string") {
    return contents;
  } else {
    return contents.value;
  }
}

const requestHoverToolTip = async (view: EditorView, position: number, side: -1 | 1) => {
  const { line, character } = offsetToPos(view.state.doc, position);
  // if (!this.client.ready || !this.client.capabilities!.hoverProvider)
  //     return null;

  const client = view.state.facet(LspClient);
  const uri = view.state.facet(DocumentUri);
  const hover: HoverParams = {
    textDocument: { uri },
    position: { line, character },
  };
  let result: unknown;
  try {
    result = await client({
      method: "textDocument/hover",
      params: hover,
    });
    const { contents, range } = result as Hover;
    if (!range) {
      throw new Error(`Range was not included in response object.`);
    }

    const pos = posToOffset(view.state.doc, range.start);
    const end = posToOffset(view.state.doc, range.end);
    if (!pos || !end) {
      return null;
    }

    // Create a DOM container for React Portal
    const dom = document.createElement("div");
    dom.classList.add("react-tooltip-container");

    let content = formatContents(contents);

    // Render React component using a Portal
    // const component = EditorToolTip({ dom, content })
    // createPortal(
    //   {<EditorToolTip
    //     top={view.coordsAtPos(position)?.top}
    //     left={view.coordsAtPos(position)?.left}
    //     content={contents}
    //   />},
    //   dom
    // );

    return { pos, end, create: () => ({ dom }), above: true };
  } catch (error) {
    console.error(`Failed to complete hover event: ${error}`);
    return null;
  }
};

const autoCompletionOverride = async (context: CompletionContext): Promise<CompletionResult | null> => {
  // if (!this.client.ready || !this.client.capabilities!.hoverProvider)
  //     return null;
  const uri = context.view?.state.facet(DocumentUri);
  const client = context.view?.state.facet(LspClient);
  if (!client || !uri) {
    return null;
  }

  const { state, pos, explicit } = context;
  const line = state.doc.lineAt(pos);
  let triggerKind: CompletionTriggerKind = CompletionTriggerKind.Invoked;
  let triggerCharacter: string | undefined;
  if (
    !explicit /* && plugin.client.capabilities?.completionProvider?.triggerCharacters?.includes(line.text[pos - line.from - 1]) */
  ) {
    triggerKind = CompletionTriggerKind.TriggerCharacter;
    triggerCharacter = line.text[pos - line.from - 1];
  } else if (triggerKind === CompletionTriggerKind.Invoked && !context.matchBefore(/\w+$/)) {
    return null;
  }

  const result = await client({
    method: "textDocument/completion",
    params: {
      textDocument: { uri },
      position: offsetToPos(state.doc, pos),
      context: {
        triggerKind,
        triggerCharacter,
      },
    },
  });

  return result as CompletionResult;
};

const languageLinter = async (view: EditorView): Promise<Diagnostic[]> => {
  // Extract required facets
  const client = view.state.facet(LspClient);
  const uri = view.state.facet(DocumentUri);

  if (!client || !uri) {
    console.warn("LSP client or Document URI not found.");
    return [];
  }

  // Create diagnostic request payload
  const params = {
    textDocument: { uri },
  };

  try {
    // Send the request to the server
    const response = await client({
      method: "textDocument/diagnostic",
      params,
    });

    // Process the server response
    const { diagnostics } = response as { diagnostics: Diagnostic[] };

    // Map LSP diagnostics to CodeMirror's Diagnostic format
    return diagnostics
      .map((diag) => {
        const { from, to, message, severity } = diag;

        if (from === undefined || to === undefined) {
          console.warn(`Invalid diagnostic range received from ${from} to $`);
          return null;
        }

        return {
          from,
          to,
          message,
          severity,
        };
      })
      .filter(Boolean) as Diagnostic[];
  } catch (error) {
    console.error("Failed to fetch diagnostics:", error);
    return [];
  }
};
