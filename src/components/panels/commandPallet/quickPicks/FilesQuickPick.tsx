import { CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import type { FileId } from "@/lib/ws/messages";
import { selectActivePanel, useEditorSessionStore } from "../../code/state/editor-session.store";
import { useCommandRunner } from "../hooks/use-command-runner";
import { useFilePicks } from "../hooks/use-file-picks";

type Props = {
  query: string;
  close: () => void;
};

export default function FilesQuickPick({ query, close }: Props) {
  const activePanel = useEditorSessionStore(selectActivePanel);
  const workspaceId = activePanel?.kind === "code" ? activePanel.workspace : null;
  const openFile = useEditorSessionStore((state) => state.openFile);
  const runCommand = useCommandRunner(close);
  const { picks, loading } = useFilePicks(query, true);

  return (
    <>
      <CommandEmpty>{loading ? "Loading…" : "No results found."}</CommandEmpty>
      <CommandGroup heading="Files">
        {picks.map((file) => (
          <CommandItem
            key={file.path}
            value={`${file.name} ${file.path}`}
            disabled={workspaceId === null}
            onSelect={() => {
              if (workspaceId !== null) {
                runCommand(() => {
                  openFile(workspaceId, file.path as FileId);
                });
              }
            }}>
            <span>{file.name}</span>
            <span className="ml-2 text-muted-foreground">{file.path}</span>
          </CommandItem>
        ))}
      </CommandGroup>
    </>
  );
}
