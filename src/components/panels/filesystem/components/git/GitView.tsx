"use client";

import { WorkspaceId } from "@/lib/ws/messages";
import { Button } from "@/components/ui/button";
import GitChangeGroup from "./GitChangeGroup";
import GitCommitForm from "./GitCommitForm";
import GitFeatureProvider, { useGitFeature } from "./GitFeatureProvider";
import GitToolbar from "./GitToolbar";

interface Props {
  workspaceId: WorkspaceId;
}

function GitViewContent() {
  const { statusQuery, status } = useGitFeature();
  if (statusQuery.isLoading) return <div className="p-3 text-sm text-muted-foreground">Loading source control…</div>;
  if (statusQuery.error)
    return (
      <div className="p-3 text-sm">
        <p className="text-red-400">{statusQuery.error.message}</p>
        <Button type="button" variant="link" className="mt-2 h-auto p-0" onClick={() => statusQuery.refetch()}>
          Retry
        </Button>
      </div>
    );
  if (!status) return null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <GitToolbar />
      <GitCommitForm />
      <div className="min-h-0 flex-1 overflow-auto">
        {!status.changes.length && <p className="p-3 text-xs text-muted-foreground">No changes.</p>}
        <GitChangeGroup title="Staged Changes" view="staged" />
        <GitChangeGroup title="Changes" view="working" />
      </div>
    </div>
  );
}

export default function GitView({ workspaceId }: Props) {
  return (
    <GitFeatureProvider workspaceId={workspaceId}>
      <GitViewContent />
    </GitFeatureProvider>
  );
}
