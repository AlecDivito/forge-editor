import { CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import type { FileId } from "@/lib/ws/messages";
import { useEditorSessionStore } from "../../code/state/editor-session.store";
import { useCommandRunner } from "../hooks/use-command-runner";
import { useFilePicks } from "../hooks/use-file-picks";
import { useWorkspaceStore } from "@/lib/workspaces";

type Props = {
  query: string;
  close: () => void;
};

export default function FilesQuickPick({ query, close }: Props) {
  const openFile = useEditorSessionStore((state) => state.openFile);
  const runCommand = useCommandRunner(close);
  const workspaces = useWorkspaceStore((state) => state.snapshot?.workspaces ?? []);
  const { picks, loading } = useFilePicks(workspaces, query, true);

  return (
    <>
      <CommandEmpty>{loading ? "Loading…" : "No results found."}</CommandEmpty>
      <CommandGroup heading="Files">
        {picks.map((file) => (
          <CommandItem
            key={`${file.workspaceId}:${file.path}`}
            value={`${file.name} ${file.path} ${file.workspaceName}`}
            onSelect={() => {
              runCommand(() => { openFile(file.workspaceId, file.path as FileId); });
            }}>
            <span>{file.name}</span>
            <span className="ml-2 text-muted-foreground">{file.path}</span>
            <span className="ml-auto text-muted-foreground">{file.workspaceName}</span>
          </CommandItem>
        ))}
      </CommandGroup>
    </>
  );
}
