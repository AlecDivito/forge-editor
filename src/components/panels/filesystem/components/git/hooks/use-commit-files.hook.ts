import { useMutation } from "@tanstack/react-query";
import { commitMutation } from "@/lib/generated/@tanstack/react-query.gen";
import { WorkspaceId } from "@/lib/ws/messages";
import useInvalidateGit from "./use-invalidate-git.hook";

export default function useCommitFiles(workspaceId: WorkspaceId) {
  const invalidate = useInvalidateGit(workspaceId);
  const mutation = useMutation({ ...commitMutation(), onSuccess: invalidate });
  return {
    ...mutation,
    commit: (message: string, onSuccess?: () => void) =>
      mutation.mutate({ body: { workspace_id: workspaceId, message } }, { onSuccess }),
  };
}
