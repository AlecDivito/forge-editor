"use client";

import { SessionState } from "@/lib/generated";
import { WorkspaceId } from "@/lib/ws/messages";
import useDebugSession from "./hooks/use-debug-session.hook";

interface Props {
  workspaceId: WorkspaceId;
}

export default function DebugView({ workspaceId }: Props) {
  const debug = useDebugSession(workspaceId);
  const list = debug.configurationsQuery.data;
  const error =
    debug.configurationsQuery.error ?? debug.createMutation.error ?? debug.sessionQuery.error ?? debug.stopMutation.error;

  return (
    <div className="flex h-full min-w-0 flex-col bg-background text-[13px] text-foreground">
      <details open className="group border-b border-border">
        <summary className="cursor-pointer select-none px-3 py-2 text-[11px] font-semibold tracking-wide focus-visible:outline focus-visible:outline-ring">
          RUN
        </summary>
        <div className="space-y-3 px-4 pb-4">
          {debug.configurationsQuery.isLoading ? (
            <p role="status" className="text-muted-foreground">Reading debug configurations…</p>
          ) : !list?.configurations.length ? (
            <div className="space-y-3 py-4 text-center">
              <button type="button" onClick={() => debug.configurationsQuery.refetch()} className="w-full rounded-sm bg-primary px-3 py-2 font-medium text-primary-foreground">
                Run and Debug
              </button>
              <p className="text-muted-foreground">To customize Run and Debug, create a <code className="text-blue-400">.vscode/launch.json</code> file, then refresh.</p>
            </div>
          ) : (
            <>
              <div className="flex min-w-0 gap-2">
                <label className="sr-only" htmlFor="debug-configuration">Debug configuration</label>
                <select id="debug-configuration" value={debug.selectedConfigurationId} disabled={debug.active || debug.pending} onChange={(event) => debug.setSelectedConfigurationId(event.target.value)} className="min-w-0 flex-1 rounded-sm border border-border bg-background px-2 py-1.5">
                  {list.configurations.map((item) => <option key={item.id} value={item.id} disabled={!item.valid}>{item.name} · {item.type}{item.valid ? "" : " (invalid)"}</option>)}
                </select>
                {!debug.active ? (
                  <button title="Start Debugging" aria-label="Start Debugging" disabled={!debug.selectedConfiguration?.valid || debug.pending} onClick={debug.start} className="rounded-sm bg-green-700 px-3 py-1.5 text-white disabled:opacity-40">▶</button>
                ) : (
                  <button title="Stop Debugging" aria-label="Stop Debugging" disabled={debug.pending || debug.session?.state === SessionState.TERMINATING} onClick={debug.stop} className="rounded-sm bg-red-700 px-3 py-1.5 text-white disabled:opacity-40">■</button>
                )}
              </div>
              {debug.selectedConfiguration && !debug.selectedConfiguration.valid && <ul className="text-amber-300">{debug.selectedConfiguration.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
              {debug.session && <div aria-live="polite" className="flex justify-between text-muted-foreground"><span className="capitalize">{debug.session.state.replaceAll("_", " ")}</span>{debug.session.exitCode != null && <span>Exit {debug.session.exitCode}</span>}</div>}
            </>
          )}
          {list?.diagnostics.map((diagnostic) => <p key={`${diagnostic.path}:${diagnostic.message}`} className="text-amber-300">{diagnostic.message}</p>)}
          {(error || debug.session?.error) && <div role="alert" className="rounded border border-red-800 bg-red-950/40 p-2 text-red-300">{debug.session?.error ?? error?.message}</div>}
        </div>
      </details>
      <details open className="min-h-0 flex-1 border-b border-border">
        <summary className="cursor-pointer select-none px-3 py-2 text-[11px] font-semibold tracking-wide">DEBUG CONSOLE</summary>
        <pre aria-label="Debug output" className="h-[calc(100%-34px)] overflow-auto whitespace-pre-wrap wrap-break-word px-4 pb-3 font-mono text-xs">{debug.session?.output.map((chunk) => chunk.output).join("") || "No debug output."}</pre>
      </details>
      <details open className="border-b border-border">
        <summary className="cursor-pointer select-none px-3 py-2 text-[11px] font-semibold tracking-wide">BREAKPOINTS</summary>
        <p className="px-4 pb-4 text-muted-foreground">No breakpoints set</p>
      </details>
    </div>
  );
}
