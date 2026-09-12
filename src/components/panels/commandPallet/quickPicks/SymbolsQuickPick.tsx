import { CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import type { FileId } from "@/lib/ws/messages";
import { selectActivePanel, useEditorSessionStore } from "../../code/state/editor-session.store";
import { useCommandRunner } from "../hooks/use-command-runner";
import { useWorkspaceSymbolPicks } from "../hooks/use-workspace-symbol-picks";

type Props = {
  query: string;
  close: () => void;
};

export default function SymbolsQuickPick({ query, close }: Props) {
  const activePanel = useEditorSessionStore(selectActivePanel);
  const fileId = activePanel?.kind === "code" ? (activePanel.fileId ?? null) : null;
  const workspaceId = activePanel?.kind === "code" ? activePanel.workspace : null;
  const openFile = useEditorSessionStore((state) => state.openFile);
  const runCommand = useCommandRunner(close);
  const { picks, loading } = useWorkspaceSymbolPicks(query, workspaceId, fileId, true);

  return (
    <>
      <CommandEmpty>{loading ? "Loading…" : "No results found."}</CommandEmpty>
      <CommandGroup heading="Symbols in Workspace">
        {picks.map((symbol, index) => (
          <CommandItem
            key={`${symbol.location.uri}:${index}`}
            value={`#${symbol.name}`}
            disabled={workspaceId === null}
            onSelect={() => {
              if (workspaceId !== null) {
                runCommand(() => {
                  const symbolFileId = symbol.location.uri.startsWith("file://")
                    ? decodeURIComponent(symbol.location.uri.slice("file://".length))
                    : symbol.location.uri;
                  openFile(workspaceId, symbolFileId as FileId);
                });
              }
            }}>
            {symbol.name}
            {symbol.containerName && <span className="ml-2 text-muted-foreground">{symbol.containerName}</span>}
          </CommandItem>
        ))}
      </CommandGroup>
    </>
  );
}
