import { CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import { selectActivePanel, useEditorSessionStore } from "../../code/state/editor-session.store";
import { useCommandRunner } from "../hooks/use-command-runner";
import { useWorkspaceSymbolPicks } from "../hooks/use-workspace-symbol-picks";
import { openEditorLocation } from "../../code/state/editor-navigation";

type Props = {
  query: string;
  close: () => void;
};

export default function SymbolsQuickPick({ query, close }: Props) {
  const activePanel = useEditorSessionStore(selectActivePanel);
  const workspaceId = activePanel?.kind === "code" ? activePanel.workspace : null;
  const runCommand = useCommandRunner(close);
  const { picks, loading } = useWorkspaceSymbolPicks(query, workspaceId, true);

  return (
    <>
      <CommandEmpty>{loading ? "Loading…" : "No results found."}</CommandEmpty>
      <CommandGroup heading="Symbols in Workspace">
        {picks.map((symbol, index) => (
          <CommandItem
            key={`${symbol.location.workspace_id}:${symbol.location.file_id}:${symbol.location.range.start.line}:${symbol.location.range.start.character}:${index}`}
            value={`#${symbol.name}`}
            disabled={workspaceId === null}
            onSelect={() => {
              if (workspaceId !== null) {
                runCommand(() => {
                  return openEditorLocation({
                    workspaceId: symbol.location.workspace_id,
                    fileId: symbol.location.file_id,
                    range: symbol.location.selection_range ?? symbol.location.range,
                  });
                });
              }
            }}>
            {symbol.name}
            {symbol.container_name && <span className="ml-2 text-muted-foreground">{symbol.container_name}</span>}
          </CommandItem>
        ))}
      </CommandGroup>
    </>
  );
}
