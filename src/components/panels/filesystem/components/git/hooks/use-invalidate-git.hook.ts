import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { WorkspaceId } from "@/lib/ws/messages";

export function isGitQueryForWorkspace(queryKey: readonly unknown[], workspaceId: WorkspaceId): boolean {
  const key = queryKey[0] as { _id?: string; query?: { workspace_id?: string } } | undefined;
  return (key?._id === "getStatus" || key?._id === "getDiff") && key.query?.workspace_id === workspaceId;
}

export default function useInvalidateGit(workspaceId: WorkspaceId) {
  const queryClient = useQueryClient();
  return useCallback(
    () => queryClient.invalidateQueries({ predicate: (query) => isGitQueryForWorkspace(query.queryKey, workspaceId) }),
    [queryClient, workspaceId],
  );
}
