import { useCallback } from "react";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { getStatusQueryKey } from "@/lib/generated/@tanstack/react-query.gen";
import { WorkspaceId } from "@/lib/ws/messages";

export default function useRefreshGitStatus(workspaceId: WorkspaceId) {
  const queryClient = useQueryClient();
  const queryKey = getStatusQueryKey({ query: { workspace_id: workspaceId } });
  const isRefreshing = useIsFetching({ queryKey, exact: true }) > 0;
  const refresh = useCallback(() => queryClient.invalidateQueries({ queryKey, exact: true }), [queryClient, queryKey]);

  return { isRefreshing, refresh };
}
