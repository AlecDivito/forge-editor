import { Check, ChevronDown, CircleAlert, Loader2, Wrench } from "lucide-react";
import { useState } from "react";
import { AgentToolActivity } from "../types/agent-harness.types";

function argumentSummary(activity: AgentToolActivity) {
  if (!activity.arguments || typeof activity.arguments !== "object" || Array.isArray(activity.arguments)) return "";
  const args = activity.arguments as Record<string, unknown>;
  for (const key of ["path", "query"]) {
    if (typeof args[key] === "string") return args[key];
  }
  return "";
}

export function ToolActivityTimeline({ activities }: { activities: AgentToolActivity[] }) {
  const running = activities.some((activity) => activity.status === "running");
  const [open, setOpen] = useState(running);
  if (!activities.length) return null;
  const label = running
    ? `Using ${activities.length} ${activities.length === 1 ? "tool" : "tools"}`
    : `Used ${activities.length} ${activities.length === 1 ? "tool" : "tools"}`;
  return (
    <details
      className="group my-1 rounded-md border border-border/60 bg-muted/25 text-xs"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-2.5 py-2 text-muted-foreground marker:content-none">
        {running ? <Loader2 className="size-3.5 animate-spin" /> : <Wrench className="size-3.5" />}
        <span className="flex-1 font-medium text-foreground/80">{label}</span>
        <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-border/50 px-2.5 py-1">
        {activities.map((activity) => {
          const summary = argumentSummary(activity);
          return (
            <div key={activity.id} className="flex min-h-7 items-center gap-2 py-1 text-muted-foreground">
              {activity.status === "running" ? (
                <Loader2 className="size-3 animate-spin" />
              ) : activity.status === "error" ? (
                <CircleAlert className="size-3 text-destructive" />
              ) : (
                <Check className="size-3 text-emerald-500" />
              )}
              <span className="font-medium text-foreground/85">{activity.name}</span>
              {summary ? <code className="min-w-0 truncate text-[11px]">{summary}</code> : null}
            </div>
          );
        })}
      </div>
    </details>
  );
}
