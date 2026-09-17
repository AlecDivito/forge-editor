import { useMutation } from "@tanstack/react-query";
import { unstageMutation } from "@/lib/generated/@tanstack/react-query.gen";
import { FileId, WorkspaceId } from "@/lib/ws/messages";
import useInvalidateGit from "./use-invalidate-git.hook";

export default function useUnstageFiles(workspaceId: WorkspaceId) {
  const invalidate = useInvalidateGit(workspaceId);
  const mutation = useMutation({ ...unstageMutation(), onSuccess: invalidate });
  return { ...mutation, unstage: (paths: FileId[]) => mutation.mutate({ body: { workspace_id: workspaceId, paths } }) };
}
