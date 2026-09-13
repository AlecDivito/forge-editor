"use client";

import { createContext, ReactNode, useContext, useMemo, useState } from "react";
import { GitChange } from "@/lib/generated";
import { FileId, WorkspaceId } from "@/lib/ws/messages";
import { useEditorSessionStore } from "@/components/panels/code/state/editor-session.store";
import useCommitFiles from "./hooks/use-commit-files.hook";
import useGitStatus from "./hooks/use-git-status.hook";
import usePushBranch from "./hooks/use-push-branch.hook";
import useStageFiles from "./hooks/use-stage-files.hook";
import useUnstageFiles from "./hooks/use-unstage-files.hook";
import { GitChangeView, GitViewMode } from "./models/git-view.model";

function mutationError(...errors: Array<unknown>): string | undefined {
  const error = errors.find(Boolean);
  if (!error) return undefined;
  if (typeof error === "object" && error && "response" in error) {
    const response = (error as { response?: { data?: { message?: string } } }).response;
    if (response?.data?.message) return response.data.message;
  }
  return error instanceof Error ? error.message : "Git operation failed";
}

function useGitFeatureValue(workspaceId: WorkspaceId) {
  const [mode, setMode] = useState<GitViewMode>("tree");
  const openDiff = useEditorSessionStore((state) => state.openDiff);
  const statusQuery = useGitStatus(workspaceId);
  const stageMutation = useStageFiles(workspaceId);
  const unstageMutation = useUnstageFiles(workspaceId);
  const commitMutation = useCommitFiles(workspaceId);
  const pushMutation = usePushBranch(workspaceId);
  const status = statusQuery.data;
  const staged = useMemo(() => status?.changes.filter((change) => change.index_status) ?? [], [status]);
  const unstaged = useMemo(() => status?.changes.filter((change) => change.worktree_status) ?? [], [status]);
  const pending =
    stageMutation.isPending || unstageMutation.isPending || commitMutation.isPending || pushMutation.isPending;
  const error = mutationError(stageMutation.error, unstageMutation.error, commitMutation.error, pushMutation.error);

  const mutate = (view: GitChangeView, changes: GitChange[]) => {
    const paths = changes.map((change) => change.path as FileId);
    return view === "staged" ? unstageMutation.unstage(paths) : stageMutation.stage(paths);
  };

  return {
    workspaceId,
    mode,
    toggleMode: () => setMode((current) => (current === "tree" ? "list" : "tree")),
    statusQuery,
    status,
    staged,
    unstaged,
    pending,
    error,
    commit: commitMutation.commit,
    push: pushMutation.push,
    mutate,
    open: (change: GitChange, view: GitChangeView) => openDiff(workspaceId, change.path as FileId, view),
  };
}

type GitFeature = ReturnType<typeof useGitFeatureValue>;
const GitFeatureContext = createContext<GitFeature | null>(null);

export function useGitFeature() {
  const feature = useContext(GitFeatureContext);
  if (!feature) throw new Error("useGitFeature must be used within GitFeatureProvider");
  return feature;
}

interface Props {
  workspaceId: WorkspaceId;
  children: ReactNode;
}

export default function GitFeatureProvider({ workspaceId, children }: Props) {
  return <GitFeatureContext.Provider value={useGitFeatureValue(workspaceId)}>{children}</GitFeatureContext.Provider>;
}
