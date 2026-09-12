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
    const handle = setTimeout(async () => {
      setLoading(true);
      try {
        const response = await searchFileNames({
          query: { search: query },
          responseType: "json",
          throwOnError: true,
        });
        const names = new Map(workspaces.map((workspace) => [workspace.id, workspace.name]));
        const result = response.data as { results?: Array<{ path: string; name: string; workspace_id: WorkspaceId }> };
        const picks = (result.results ?? []).map((file) => ({
          path: file.path,
          name: file.name,
          workspaceId: file.workspace_id,
          workspaceName: names.get(file.workspace_id) ?? file.workspace_id,
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
      clearTimeout(handle);
    };
  }, [enabled, query, workspaces]);

  return { picks, loading };
}
