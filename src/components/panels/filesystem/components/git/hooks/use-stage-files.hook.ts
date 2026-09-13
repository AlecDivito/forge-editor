import { useMutation } from "@tanstack/react-query";
import { stageMutation } from "@/lib/generated/@tanstack/react-query.gen";
import { FileId, WorkspaceId } from "@/lib/ws/messages";
import useInvalidateGit from "./use-invalidate-git.hook";

export default function useStageFiles(workspaceId: WorkspaceId) {
  const invalidate = useInvalidateGit(workspaceId);
  const mutation = useMutation({ ...stageMutation(), onSuccess: invalidate });
  return { ...mutation, stage: (paths: FileId[]) => mutation.mutate({ body: { workspace_id: workspaceId, paths } }) };
}
