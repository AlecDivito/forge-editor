import { useEffect, useState } from "react";
import type { SymbolInformation } from "vscode-languageserver-protocol";
import { workspaceSymbols } from "@/lib/ws/lsp-actions";
import type { FileId, WorkspaceId } from "@/lib/ws/messages";

export function useWorkspaceSymbolPicks(
  query: string,
  workspaceId: WorkspaceId | null,
  fileId: FileId | null,
  enabled: boolean,
) {
  const [picks, setPicks] = useState<SymbolInformation[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled || workspaceId === null || fileId === null || query.length === 0) {
      setPicks([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const handle = setTimeout(() => {
      setLoading(true);
      workspaceSymbols(workspaceId, fileId, query)
        .then((result) => {
          if (!cancelled) setPicks(result ?? []);
        })
        .catch(() => {
          if (!cancelled) setPicks([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 150);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [enabled, fileId, query, workspaceId]);

  return { picks, loading };
}
