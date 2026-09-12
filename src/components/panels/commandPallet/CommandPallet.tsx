"use client";

import { useCallback, useEffect, useState } from "react";
import { useKeyboard } from "react-pre-hooks";
import { CommandDialog, CommandInput, CommandList } from "@/components/ui/command";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { quickPickMode, quickPickQuery } from "./hooks/use-quick-pick-mode";
import CommandsQuickPick from "./quickPicks/CommandsQuickPick";
import FilesQuickPick from "./quickPicks/FilesQuickPick";
import PropertiesQuickPick from "./quickPicks/PropertiesQuickPick";
import SymbolsQuickPick from "./quickPicks/SymbolsQuickPick";

export default function CommandPallet() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");

  const showQuickPick = useCallback((prefix: string) => {
    setValue(prefix);
    setOpen(true);
  }, []);

  useKeyboard({
    keys: {
      "ctrl+p": (event) => {
        event.preventDefault();
        showQuickPick("");
      },
      "meta+p": (event) => {
        event.preventDefault();
        showQuickPick("");
      },
      "meta+shift+p": (event) => {
        event.preventDefault();
        showQuickPick(">");
      },
      "ctrl+shift+p": (event) => {
        event.preventDefault();
        showQuickPick(">");
      },
    },
  });

  useEffect(() => {
    if (!open) setValue("");
  }, [open]);

  const mode = quickPickMode(value);
  const query = quickPickQuery(value);
  const close = useCallback(() => setOpen(false), []);

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <DialogTitle title="Command Palette" aria-description="Quick Access" />
      <DialogDescription title="Search files, or use > for commands, # for workspace symbols, @ for declarations, or : for lines." />
      <CommandInput
        value={value}
        onValueChange={setValue}
        placeholder="Search files, or use > commands, # symbols, @ declarations, or : lines..."
      />
      <CommandList>
        {mode === "commands" && <CommandsQuickPick close={close} />}
        {mode === "symbols" && <SymbolsQuickPick query={query} close={close} />}
        {mode === "properties" && <PropertiesQuickPick prefix={value[0] as "@" | ":"} />}
        {mode === "files" && <FilesQuickPick query={query} close={close} />}
      </CommandList>
    </CommandDialog>
  );
}
