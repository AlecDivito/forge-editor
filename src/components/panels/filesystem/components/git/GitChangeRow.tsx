import { GitCompare, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GitChange } from "@/lib/generated";
import { useGitFeature } from "./GitFeatureProvider";
import { GitChangeView, gitStatusLabel } from "./models/git-view.model";

interface Props {
  change: GitChange;
  view: GitChangeView;
}

export default function GitChangeRow({ change, view }: Props) {
  const { pending, open, mutate } = useGitFeature();
  const name = change.path.split("/").pop();
  const directory = change.path.slice(1, -(name?.length ?? 0)).replace(/\/$/, "");
  const code = view === "staged" ? change.index_status : change.worktree_status;
  return (
    <div className="group flex items-center gap-1 px-2 py-1 text-xs hover:bg-sidebar" title={change.path}>
      <Button
        type="button"
        variant="ghost"
        className="h-auto min-w-0 flex-1 justify-start rounded-none px-0 py-0 text-xs font-normal"
        onClick={() => open(change, view)}>
        <GitCompare size={13} className="shrink-0" />
        <span className="truncate">{name}</span>
        <span className="truncate text-muted-foreground">{directory}</span>
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={pending}
        onClick={() => mutate(view, [change])}
        className="size-6"
        title={view === "staged" ? "Unstage" : "Stage"}>
        {view === "staged" ? "−" : <Plus size={13} />}
      </Button>
      <Badge
        variant="outline"
        className={`border-0 px-1 py-0 ${change.conflicted ? "text-red-400" : "text-amber-400"}`}>
        {gitStatusLabel(code)}
      </Badge>
    </div>
  );
}
