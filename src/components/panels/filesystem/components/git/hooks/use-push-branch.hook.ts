import { useMutation } from "@tanstack/react-query";
import { pushMutation } from "@/lib/generated/@tanstack/react-query.gen";
import { WorkspaceId } from "@/lib/ws/messages";
import useInvalidateGit from "./use-invalidate-git.hook";

export default function usePushBranch(workspaceId: WorkspaceId) {
  const invalidate = useInvalidateGit(workspaceId);
  const mutation = useMutation({ ...pushMutation(), onSuccess: invalidate });
  return { ...mutation, push: () => mutation.mutate({ body: { workspace_id: workspaceId } }) };
}
