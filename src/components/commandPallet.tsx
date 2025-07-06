import { useKeyboard } from "react-pre-hooks";
import {
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
  CommandDialog,
} from "./ui/command";
import { useState } from "react";
import { DialogDescription, DialogTitle } from "./ui/dialog";

export default function CommandPallet() {
  const [open, setOpen] = useState(false);
  const toggle = () => {
    setOpen((open) => !open);
    console.log(open);
  };

  useKeyboard({
    keys: {
      "ctrl+p": toggle,
      "meta+shift+p": toggle,
      "meta+p": toggle,
    },
  });
  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <DialogTitle title="Command Pallete" aria-description="Search for items in the code base" />
      <DialogDescription title="Command Pallete search bar" />
      <CommandInput placeholder="Type a command or search..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="File System">
          <CommandItem>Calendar</CommandItem>
          <CommandItem>Search Emoji</CommandItem>
          <CommandItem>Calculator</CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Settings">
          <CommandItem>Profile</CommandItem>
          <CommandItem>Billing</CommandItem>
          <CommandItem>Settings</CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
