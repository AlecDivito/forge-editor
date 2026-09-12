import { CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import type { FileId } from "@/lib/ws/messages";
import { useCommandRunner } from "../hooks/use-command-runner";
import { useFilePicks } from "../hooks/use-file-picks";
import { useWorkspaceStore } from "@/lib/workspaces";
import { openEditorLocation } from "../../code/state/editor-navigation";
import type { FileQueryTarget } from "../hooks/use-quick-pick-mode";

type Props = {
  query: string;
  target: FileQueryTarget;
  close: () => void;
};

export default function FilesQuickPick({ query, target, close }: Props) {
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
              runCommand(() => openEditorLocation({
                workspaceId: file.workspaceId,
                fileId: file.path as FileId,
                position: target.line === undefined ? undefined : {
                  line: Math.max(0, target.line - 1),
                  character: Math.max(0, (target.column ?? 1) - 1),
                },
              }));
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
