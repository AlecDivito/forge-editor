import { CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import { getActiveDocument } from "../../code/state/active-editor";
import { openEditorLocation } from "../../code/state/editor-navigation";
import { parseLineTarget } from "../hooks/use-quick-pick-mode";
import { useCommandRunner } from "../hooks/use-command-runner";

export default function LineQuickPick({ query, close }: { query: string; close: () => void }) {
  const target = parseLineTarget(query);
  const runCommand = useCommandRunner(close);
  return <>
    <CommandEmpty>{query ? "Enter a line and optional column, for example :42:7." : "Enter a line number."}</CommandEmpty>
    <CommandGroup heading="Go to Line">
      {target && <CommandItem value={`:${target.line}:${target.column}`} onSelect={() => runCommand(async () => {
        const document = getActiveDocument();
        if (!document) throw new Error("No active code editor");
        await openEditorLocation({
          workspaceId: document.workspace,
          fileId: document.fileId,
          position: { line: Math.max(0, target.line - 1), character: Math.max(0, target.column - 1) },
        });
      })}>Go to line {target.line}, column {target.column}</CommandItem>}
    </CommandGroup>
  </>;
}
