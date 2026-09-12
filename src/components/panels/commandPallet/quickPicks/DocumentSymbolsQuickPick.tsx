import { useEffect, useMemo, useState } from "react";
import { CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import type { DocumentSymbol, SymbolInformation } from "vscode-languageserver-protocol";
import { documentSymbols } from "@/lib/ws/lsp-actions";
import { selectActivePanel, useEditorSessionStore } from "../../code/state/editor-session.store";
import { openEditorLocation } from "../../code/state/editor-navigation";
import { useCommandRunner } from "../hooks/use-command-runner";

type Pick = { name: string; breadcrumb: string; kind: number; range: DocumentSymbol["range"]; selectionRange: DocumentSymbol["selectionRange"] };

function flatten(symbols: DocumentSymbol[], parents: string[] = []): Pick[] {
  return symbols.flatMap((symbol) => {
    const breadcrumb = [...parents, symbol.name].join(" › ");
    return [
      { name: symbol.name, breadcrumb, kind: symbol.kind, range: symbol.range, selectionRange: symbol.selectionRange },
      ...flatten(symbol.children ?? [], [...parents, symbol.name]),
    ];
  });
}

export default function DocumentSymbolsQuickPick({ query, close }: { query: string; close: () => void }) {
  const panel = useEditorSessionStore(selectActivePanel);
  const [symbols, setSymbols] = useState<Pick[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const runCommand = useCommandRunner(close);
  useEffect(() => {
    if (!panel || panel.kind !== "code") { setSymbols([]); return; }
    const controller = new AbortController();
    setLoading(true); setError(undefined);
    documentSymbols(panel.workspace, panel.fileId, controller.signal).then((result) => {
      if (!result) return setSymbols([]);
      const first = result[0];
      if (first && "selectionRange" in first) setSymbols(flatten(result as DocumentSymbol[]));
      else setSymbols((result as SymbolInformation[]).map((symbol) => ({
        name: symbol.name, breadcrumb: symbol.containerName ? `${symbol.containerName} › ${symbol.name}` : symbol.name,
        kind: symbol.kind, range: symbol.location.range, selectionRange: symbol.location.range,
      })));
    }).catch((reason) => {
      if (reason?.name !== "AbortError") setError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [panel]);
  const picks = useMemo(() => {
    const needle = query.toLocaleLowerCase();
    return symbols.filter((symbol) => symbol.breadcrumb.toLocaleLowerCase().includes(needle));
  }, [query, symbols]);
  return <>
    <CommandEmpty>{loading ? "Loading…" : error ?? "No symbols found."}</CommandEmpty>
    <CommandGroup heading="Symbols in Active File">
      {panel?.kind === "code" && picks.map((symbol) => <CommandItem
        key={`${symbol.breadcrumb}:${symbol.selectionRange.start.line}:${symbol.selectionRange.start.character}`}
        value={`@${symbol.breadcrumb}`}
        onSelect={() => runCommand(() => openEditorLocation({ workspaceId: panel.workspace, fileId: panel.fileId, range: symbol.selectionRange }))}
      ><span>{symbol.name}</span><span className="ml-2 text-muted-foreground">{symbol.breadcrumb}</span></CommandItem>)}
    </CommandGroup>
  </>;
}
