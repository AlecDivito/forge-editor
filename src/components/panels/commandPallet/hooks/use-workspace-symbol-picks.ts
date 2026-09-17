import { useEffect, useState } from "react";
import { workspaceSymbols } from "@/lib/ws/lsp-actions";
import type { CanonicalSymbol, WorkspaceId } from "@/lib/ws/messages";

export function useWorkspaceSymbolPicks(
  query: string,
  workspaceId: WorkspaceId | null,
  enabled: boolean,
) {
  const [picks, setPicks] = useState<CanonicalSymbol[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled || workspaceId === null) {
      setPicks([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    const handle = setTimeout(() => {
      setLoading(true);
      workspaceSymbols(workspaceId, query, controller.signal)
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
      controller.abort();
      clearTimeout(handle);
    };
  }, [enabled, query, workspaceId]);

  return { picks, loading };
}
