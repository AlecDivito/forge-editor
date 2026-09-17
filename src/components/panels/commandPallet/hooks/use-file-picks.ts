import { useEffect, useState } from "react";
import { searchFileNames } from "@/lib/generated";
import { WorkspaceId } from "@/lib/ws/messages";
import { PublicWorkspace } from "@/lib/workspaces";

export type FilePick = {
  path: string;
  name: string;
  workspaceId: WorkspaceId;
  workspaceName: string;
};

export function useFilePicks(workspaces: PublicWorkspace[], query: string, enabled: boolean) {
  const [picks, setPicks] = useState<FilePick[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled || query.length === 0) {
      setPicks([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    const handle = setTimeout(async () => {
      setLoading(true);
      try {
        const response = await searchFileNames({
          query: { search: query, max_results: 1000 },
          responseType: "json",
          signal: controller.signal,
          throwOnError: true,
        });
        const names = new Map(workspaces.map((workspace) => [workspace.id, workspace.name]));
        const picks = response.data.results.map((file) => ({
          path: file.path,
          name: file.name,
          workspaceId: file.workspace_id as WorkspaceId,
          workspaceName: names.get(file.workspace_id as WorkspaceId) ?? file.workspace_id,
        }));
        if (!cancelled) setPicks(picks);
      } catch {
        if (!cancelled) setPicks([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 120);

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(handle);
    };
  }, [enabled, query, workspaces]);

  return { picks, loading };
}
