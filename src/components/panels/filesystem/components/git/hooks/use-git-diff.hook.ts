import { useQuery } from "@tanstack/react-query";
import { getDiffOptions } from "@/lib/generated/@tanstack/react-query.gen";
import { FileId, WorkspaceId } from "@/lib/ws/messages";
import { GitChangeView } from "../models/git-view.model";

export default function useGitDiff(workspaceId: WorkspaceId, path: FileId, view: GitChangeView) {
  return useQuery(getDiffOptions({ query: { workspace_id: workspaceId, path, view } }));
}
