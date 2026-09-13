import { useState } from "react";
import { GitCommit, Network } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useGitFeature } from "./GitFeatureProvider";

export default function GitCommitForm() {
  const [message, setMessage] = useState("");
  const { status, staged, pending, error, commit, push } = useGitFeature();
  const commitMessage = () => commit(message, () => setMessage(""));

  return (
    <div className="space-y-2 p-2">
      <Textarea
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        placeholder="Message (commit staged changes)"
        className="resize-y bg-background text-xs"
      />
      <div className="flex gap-1">
        <Button
          type="button"
          size="sm"
          disabled={!message.trim() || !staged.length || pending || !status?.identity_configured}
          className="h-7 flex-1"
          onClick={commitMessage}>
          <GitCommit size={13} /> Commit
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          disabled={!status?.can_push || pending}
          className="size-7"
          title="Push current branch"
          onClick={push}>
          <Network size={13} />
        </Button>
      </div>
      {!status?.identity_configured && (
        <p className="text-xs text-amber-400">Configure Git user.name and user.email to commit.</p>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
