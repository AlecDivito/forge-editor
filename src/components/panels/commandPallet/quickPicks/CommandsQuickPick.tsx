import { CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import { useCommandRunner } from "../hooks/use-command-runner";
import { editorCommands } from "../command-registry";

type Props = {
  close: () => void;
};

export default function CommandsQuickPick({ close }: Props) {
  const runCommand = useCommandRunner(close);

  return (
    <>
      <CommandEmpty>No results found.</CommandEmpty>
      <CommandGroup heading="Commands">
        {editorCommands.map((command) => {
          const availability = command.availability();
          return <CommandItem key={command.id}
            value={`>${command.title} ${command.category} ${command.keybinding ?? ""}`}
            disabled={!availability.enabled}
            title={availability.reason}
            onSelect={() => runCommand(command.run)}>
            <span>{command.title}</span>
            <span className="ml-2 text-muted-foreground">{command.category}</span>
            {command.keybinding && <span className="ml-auto text-muted-foreground">{command.keybinding}</span>}
          </CommandItem>;
        })}
      </CommandGroup>
    </>
  );
}
