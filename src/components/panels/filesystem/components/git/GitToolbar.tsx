import { GitBranch, List, RefreshCw, TreePine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useGitFeature } from "./GitFeatureProvider";
import useRefreshGitStatus from "./hooks/use-refresh-git-status.hook";

export default function GitToolbar() {
  const { workspaceId, status, mode, toggleMode } = useGitFeature();
  const { isRefreshing, refresh } = useRefreshGitStatus(workspaceId);

  return (
    <div className="flex items-center gap-2 border-b p-2 text-xs">
      <GitBranch size={14} />
      <span className="min-w-0 flex-1 truncate">{status?.branch ?? "Detached HEAD"}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7"
        onClick={toggleMode}
        title={`Use ${mode === "tree" ? "list" : "tree"} view`}>
        {mode === "tree" ? <List size={14} /> : <TreePine size={14} />}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7"
        disabled={isRefreshing}
        onClick={() => void refresh()}
        title="Refresh">
        {isRefreshing ? <Spinner /> : <RefreshCw size={14} />}
      </Button>
    </div>
  );
}
