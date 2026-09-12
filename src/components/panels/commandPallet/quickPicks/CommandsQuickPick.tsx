import { CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import { saveAllOpenDocuments, saveDocument } from "@/lib/documents/save";
import { selectActivePanel, useEditorSessionStore } from "../../code/state/editor-session.store";
import { useCommandRunner } from "../hooks/use-command-runner";

type Props = {
  close: () => void;
};

export default function CommandsQuickPick({ close }: Props) {
  const activePanel = useEditorSessionStore(selectActivePanel);
  const fileId = activePanel?.kind === "code" ? (activePanel.fileId ?? null) : null;
  const workspaceId = activePanel?.kind === "code" ? activePanel.workspace : null;
  const runCommand = useCommandRunner(close);

  return (
    <>
      <CommandEmpty>No results found.</CommandEmpty>
      <CommandGroup heading="Commands">
        <CommandItem
          value=">save file"
          disabled={workspaceId === null || fileId === null}
          onSelect={() => {
            if (workspaceId !== null && fileId !== null) {
              runCommand(() => saveDocument(workspaceId, fileId).then(() => undefined));
            }
          }}>
          Save File
        </CommandItem>
        <CommandItem
          value=">save all files"
          onSelect={() =>
            runCommand(async () => {
              const outcome = await saveAllOpenDocuments();
              if (outcome.failures.length > 0) {
                console.error("Some documents failed to save", outcome.failures);
              }
            })
          }>
          Save All Files
        </CommandItem>
      </CommandGroup>
    </>
  );
}
