import { CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";

type Props = {
  prefix: "@" | ":";
};

export default function PropertiesQuickPick({ prefix }: Props) {
  const declarationSearch = prefix === "@";
  return (
    <>
      <CommandEmpty>No results found.</CommandEmpty>
      <CommandGroup heading={declarationSearch ? "Declarations in Active File" : "Go to Line"}>
        <CommandItem disabled value={prefix}>
          {declarationSearch
            ? "TODO: search declarations in the active file"
            : "TODO: jump to a line in the active file"}
        </CommandItem>
      </CommandGroup>
    </>
  );
}
