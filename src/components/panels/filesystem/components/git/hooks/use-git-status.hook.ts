import { useQuery } from "@tanstack/react-query";
import { getStatusOptions } from "@/lib/generated/@tanstack/react-query.gen";
import { WorkspaceId } from "@/lib/ws/messages";

export default function useGitStatus(workspaceId: WorkspaceId) {
  return useQuery({
    ...getStatusOptions({ query: { workspace_id: workspaceId } }),
    retry: false,
  });
}
