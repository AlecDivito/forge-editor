"use client";

import { useKeyboard } from "react-pre-hooks";
import {
  CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem, CommandSeparator, CommandDialog,
} from "@/components/ui/command";
import { useCallback, useEffect, useState } from "react";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
// import { getActiveEditor, offsetToPosition } from "@/lib/lsp/active-editor";
import type { SymbolInformation } from "vscode-languageserver-protocol";
import { workspaceSymbols } from "@/lib/ws/lsp-actions";
import { useUICodeState } from "../code/hooks/use-code-ui-state.hook";
import type { FileId, WorkspaceId } from "@/lib/ws/messages";
import { searchFileNames } from "@/lib/generated";

type FileSearchResult = { path: string; name: string };
type Mode = "root" | "file" | "symbol-workspace";

function modeForValue(value: string): Mode {
  if (value.startsWith("#")) return "symbol-workspace";
  if (value.trim()) return "file";
  return "root";
}
const stripPrefix = (value: string) => value.replace(/^#/, "");

export default function CommandPallet() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [wsSymbols, setWsSymbols] = useState<SymbolInformation[]>([]);
  const [fileResults, setFileResults] = useState<FileSearchResult[]>([]);
  const activeFileId = useUICodeState((s) => s.activeFileId)
  const activeWorkspaceId = useUICodeState((s) => s.activeWorkspaceId)
  const openFile = useUICodeState((s) => s.openFile)
  const openPanels = useUICodeState((s) => s.openPanels)

  const toggle = (event: KeyboardEvent) => {
    event.preventDefault();
    setOpen((o) => !o);
  };
  useKeyboard({ keys: { "ctrl+p": toggle, "meta+shift+p": toggle, "meta+p": toggle } });

  useEffect(() => {
    if (!open) return;
    setValue("");
    setWsSymbols([]);
    setFileResults([]);
  }, [open]);

  const mode = modeForValue(value);
  const query = stripPrefix(value);

  useEffect(() => {
    if (mode !== "file" || query.length === 0) {
      setFileResults([]);
      return;
    }

    let cancelled = false;
    const handle = setTimeout(async () => {
      setLoading(true);
      try {
        const response = await searchFileNames({
          query: { search: query },
          responseType: "json",
          throwOnError: true,
        });
        const result = response.data as { results?: FileSearchResult[] };
        if (!cancelled) setFileResults(result.results ?? []);
      } catch {
        if (!cancelled) setFileResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 120);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [mode, query]);

  // "#" — workspace symbol search is server-filtered, so re-query per
  // keystroke (debounced) instead of relying on cmdk's client-side filter.
  useEffect(() => {
    if (mode !== "symbol-workspace") return;
    if (activeWorkspaceId === null || activeFileId === null || query.length === 0) { setWsSymbols([]); return; }
    let cancelled = false;
    const handle = setTimeout(() => {
      setLoading(true);
      workspaceSymbols(activeWorkspaceId, activeFileId, query)
        .then((res) => { if (!cancelled) setWsSymbols(res ?? []); })
        .catch(() => { if (!cancelled) setWsSymbols([]); })
        .finally(() => !cancelled && setLoading(false));
    }, 150);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [mode, query, activeWorkspaceId, activeFileId]);

  const runCommand = useCallback((fn: () => void | Promise<void>) => {
    setOpen(false);
    void fn();
  }, []);

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <DialogTitle title="Command Palette" aria-description="Search for items in the code base" />
      <DialogDescription title="Command Palette search bar" />
      <CommandInput value={value} onValueChange={setValue} placeholder="Search files, or use # for workspace symbols..." />
      <CommandList>
        <CommandEmpty>{loading ? "Loading…" : "No results found."}</CommandEmpty>

        {mode === "root" && (
          <>
          <CommandGroup heading="Go to">
            <CommandItem onSelect={() => setValue("#")}>{"#"} Symbol in Workspace</CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Open Editors">
            {openPanels.filter((panel) => panel.kind === "code" && panel.fileId).map((panel) => (
              <CommandItem
                key={panel.id}
                value={panel.fileId!}
                onSelect={() => runCommand(() => {
                  openFile(panel.workspace, panel.fileId!);
                })}
              >
                {panel.fileId}
              </CommandItem>
            ))}
          </CommandGroup>
          </>
        )}

        {mode === "file" && (
          <CommandGroup heading="Files">
            {fileResults.map((file) => (
              <CommandItem
                key={file.path}
                value={`${file.name} ${file.path}`}
                onSelect={() => runCommand(() => {
                  openFile(
                    (activeWorkspaceId ?? "") as WorkspaceId,
                    file.path as FileId,
                  );
                })}
              >
                <span>{file.name}</span>
                <span className="ml-2 text-muted-foreground">{file.path}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {mode === "symbol-workspace" && (
          <CommandGroup heading="Symbols in Workspace">
            {wsSymbols.map((s, i) => (
              <CommandItem
                key={i}
                value={s.name}
                onSelect={() => runCommand(() => {
                  const fileId = s.location.uri.startsWith("file://")
                    ? decodeURIComponent(s.location.uri.slice("file://".length))
                    : s.location.uri;
                  openFile((activeWorkspaceId ?? "") as WorkspaceId, fileId as FileId);
                })}
              >
                {s.name}
                {s.containerName && <span className="ml-2 text-muted-foreground">{s.containerName}</span>}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        
        {/* 
        <CommandSeparator />
        <CommandGroup heading="Settings">
          <CommandItem>Profile</CommandItem>
          <CommandItem>Settings</CommandItem>
        </CommandGroup>
        */}
      </CommandList>
    </CommandDialog>
  );
}
