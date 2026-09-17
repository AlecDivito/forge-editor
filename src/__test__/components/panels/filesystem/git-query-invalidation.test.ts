import { getDiffQueryKey, getStatusQueryKey, listFilesQueryKey } from "@/lib/generated/@tanstack/react-query.gen";
import { isGitQueryForWorkspace } from "@/components/panels/filesystem/components/git/hooks/use-invalidate-git.hook";
import { WorkspaceId } from "@/lib/ws/messages";

describe("Git generated-query invalidation", () => {
  const workspace = "workspace-a" as WorkspaceId;

  it("matches generated status and diff keys only for the requested workspace", () => {
    expect(isGitQueryForWorkspace(getStatusQueryKey({ query: { workspace_id: workspace } }), workspace)).toBe(true);
    expect(
      isGitQueryForWorkspace(
        getDiffQueryKey({ query: { workspace_id: workspace, path: "/src/main.ts", view: "working" } }),
        workspace,
      ),
    ).toBe(true);
    expect(isGitQueryForWorkspace(getStatusQueryKey({ query: { workspace_id: "workspace-b" } }), workspace)).toBe(
      false,
    );
  });

  it("does not invalidate generated filesystem queries", () => {
    expect(
      isGitQueryForWorkspace(
        listFilesQueryKey({ query: { workspace_id: workspace, path: "/", page: 0, size: 100 } }),
        workspace,
      ),
    ).toBe(false);
  });
});
