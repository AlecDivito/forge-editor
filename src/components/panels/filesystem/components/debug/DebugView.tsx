"use client";

import { SessionState } from "@/lib/generated";
import { FileId, WorkspaceId } from "@/lib/ws/messages";
import useDebugSession from "./hooks/use-debug-session.hook";
import { useEffect, useState } from "react";
import { useDebugIntentStore } from "@/store/debug";
import { useDebugRuntimeStore } from "@/store/debug-runtime";
import { openEditorLocation } from "@/components/panels/code/state/editor-navigation";
import { useShallow } from "zustand/react/shallow";

interface Props {
  workspaceId: WorkspaceId;
}

function VariableNode({ variable }: { variable: import("@/store/debug-runtime").DebugVariable }) {
  const values = useDebugRuntimeStore((state) =>
    variable.variablesHandle ? state.variables[variable.variablesHandle] : undefined,
  );
  const truncated = useDebugRuntimeStore((state) =>
    variable.variablesHandle ? state.variableTruncated[variable.variablesHandle] : false,
  );
  const loading = useDebugRuntimeStore((state) => state.loading === variable.variablesHandle);
  const load = useDebugRuntimeStore((state) => state.variablesLoad);
  return (
    <li role="treeitem" aria-expanded={values ? true : undefined} className="pl-4">
      <button
        className="w-full truncate text-left"
        disabled={!variable.variablesHandle || loading}
        onClick={() => variable.variablesHandle && void load(variable.variablesHandle)}>
        {variable.variablesHandle ? values ? "▾ " : "▸ " : ""}
        <span>{variable.name}</span>: {" "}
        <span className="text-muted-foreground">{variable.value}{variable.valueTruncated ? "…" : ""}</span>
      </button>
      {values && (
        <ul role="group">
          {values.map((child, index) => <VariableNode key={`${child.name}:${index}`} variable={child} />)}
          {truncated && <li className="pl-4 text-muted-foreground">Results truncated</li>}
        </ul>
      )}
    </li>
  );
}

export default function DebugView({ workspaceId }: Props) {
  const debug = useDebugSession(workspaceId);
  const breakpoints = useDebugIntentStore(useShallow((s) => s.byWorkspace[workspaceId] ?? []));
  const loadBreakpoints = useDebugIntentStore((s) => s.load);
  const updateBreakpoint = useDebugIntentStore((s) => s.update);
  const removeBreakpoint = useDebugIntentStore((s) => s.remove);
  const setSessionVerification = useDebugIntentStore((s) => s.setSessionVerification);
  const replaceBreakpoints = useDebugIntentStore((s) => s.replace);
  const runtime = useDebugRuntimeStore();
  const [expression, setExpression] = useState("");
  const [watchExpression, setWatchExpression] = useState("");
  const [breakpointEditor, setBreakpointEditor] = useState<{
    breakpointId: string;
    field: "condition" | "hitCondition" | "logMessage";
    value: string;
  }>();
  const [breakpointEditorError, setBreakpointEditorError] = useState<string>();
  const [evaluations, setEvaluations] = useState<Array<{ expression: string; value: string; error?: boolean; unknown?: boolean }>>([]);
  const appendEvaluation = (record: { expression: string; value: string; error?: boolean; unknown?: boolean }) => {
    setEvaluations((existing) => {
      const records = [...existing, record].slice(-1000);
      let bytes = records.reduce(
        (total, item) => total + new TextEncoder().encode(item.expression).length + new TextEncoder().encode(item.value).length,
        0,
      );
      while (records.length > 1 && bytes > 256 * 1024) {
        const removed = records.shift()!;
        bytes -= new TextEncoder().encode(removed.expression).length + new TextEncoder().encode(removed.value).length;
      }
      return records;
    });
  };
  const editBreakpoint = (
    breakpoint: (typeof breakpoints)[number],
    field: "condition" | "hitCondition" | "logMessage",
  ) => {
    setBreakpointEditorError(undefined);
    setBreakpointEditor({ breakpointId: breakpoint.breakpointId, field, value: breakpoint[field] ?? "" });
  };
  useEffect(() => {
    void loadBreakpoints(workspaceId);
  }, [loadBreakpoints, workspaceId]);
  useEffect(() => {
    const session = debug.session;
    if (session?.state === SessionState.STOPPED && session.stoppedGeneration != null) {
      runtime.reset({
        workspace: workspaceId,
        session: session.sessionId,
        attachment: session.attachmentGeneration,
        generation: session.stoppedGeneration,
      });
      void runtime.threadsLoad();
    } else runtime.reset();
  }, [debug.session?.sessionId, debug.session?.state, debug.session?.stoppedGeneration, workspaceId]);
  useEffect(() => {
    if (debug.session) {
      setSessionVerification(debug.session.sessionId, debug.session.verifiedBreakpoints);
      replaceBreakpoints(workspaceId, debug.session.requestedBreakpoints);
    }
  }, [debug.session?.sessionId, debug.session?.eventCursor, replaceBreakpoints, setSessionVerification, workspaceId]);
  useEffect(() => {
    const thread = runtime.threads[0];
    if (thread && !runtime.frames.length) void runtime.stackLoad(thread.threadHandle);
  }, [runtime.threads]);
  useEffect(() => {
    if (debug.session?.state !== SessionState.STOPPED) return;
    for (const watch of runtime.watches) {
      if (watch.autoRefresh && watch.generation !== debug.session.stoppedGeneration)
        void runtime.watchRefresh(watch.id);
    }
  }, [debug.session?.stoppedGeneration, debug.session?.state, runtime.watches]);
  const list = debug.configurationsQuery.data;
  const error =
    debug.configurationsQuery.error ??
    debug.createMutation.error ??
    debug.sessionQuery.error ??
    debug.stopMutation.error ??
    debug.restartError;

  return (
    <div className="relative flex h-full min-w-0 flex-col bg-background text-[13px] text-foreground">
      <details open className="group border-b border-border">
        <summary className="cursor-pointer select-none px-3 py-2 text-[11px] font-semibold tracking-wide focus-visible:outline focus-visible:outline-ring">
          RUN
        </summary>
        <div className="space-y-3 px-4 pb-4">
          {debug.configurationsQuery.isLoading ? (
            <p role="status" className="text-muted-foreground">
              Reading debug configurations…
            </p>
          ) : !list?.configurations.length ? (
            <div className="space-y-3 py-4 text-center">
              <button
                type="button"
                onClick={() => debug.configurationsQuery.refetch()}
                className="w-full rounded-sm bg-primary px-3 py-2 font-medium text-primary-foreground">
                Run and Debug
              </button>
              <p className="text-muted-foreground">
                To customize Run and Debug, create a <code className="text-blue-400">.vscode/launch.json</code> file,
                then refresh.
              </p>
            </div>
          ) : (
            <>
              <div className="flex min-w-0 gap-2">
                <label className="sr-only" htmlFor="debug-configuration">
                  Debug configuration
                </label>
                <select
                  id="debug-configuration"
                  value={debug.selectedConfigurationId}
                  disabled={debug.active || debug.pending}
                  onChange={(event) => debug.setSelectedConfigurationId(event.target.value)}
                  className="min-w-0 flex-1 rounded-sm border border-border bg-background px-2 py-1.5">
                  {list.configurations.map((item) => (
                    <option key={item.id} value={item.id} disabled={!item.valid}>
                      {item.name} · {item.type}
                      {item.valid ? "" : " (invalid)"}
                    </option>
                  ))}
                </select>
                {debug.session?.state === SessionState.STOPPED && runtime.threads[0] && (
                  <div className="flex gap-1">
                    <button
                      title="Continue"
                      aria-label="Continue"
                      onClick={() => void runtime.execute("continue", runtime.threads[0].threadHandle)}>
                      ▶
                    </button>
                    <button
                      title="Step over"
                      aria-label="Step over"
                      onClick={() => void runtime.execute("next", runtime.threads[0].threadHandle)}>
                      ↷
                    </button>
                    <button
                      title="Step into"
                      aria-label="Step into"
                      onClick={() => void runtime.execute("step_in", runtime.threads[0].threadHandle)}>
                      ↓
                    </button>
                    <button
                      title="Step out"
                      aria-label="Step out"
                      onClick={() => void runtime.execute("step_out", runtime.threads[0].threadHandle)}>
                      ↑
                    </button>
                  </div>
                )}
                {debug.session?.state === SessionState.RUNNING && debug.session.runtimeCapabilities.supportsPause && (
                  <button
                    title="Pause"
                    aria-label="Pause"
                    onClick={() => void runtime.pause(workspaceId, debug.session!.sessionId, debug.session!.attachmentGeneration)}>
                    Ⅱ
                  </button>
                )}
                {debug.active && (
                  <button
                    title="Restart debugging"
                    aria-label="Restart debugging"
                    disabled={debug.pending || debug.restartPending}
                    onClick={() => void debug.restart()}>
                    ↻
                  </button>
                )}
                {!debug.active ? (
                  <button
                    title="Start Debugging"
                    aria-label="Start Debugging"
                    disabled={!debug.selectedConfiguration?.valid || debug.pending}
                    onClick={debug.start}
                    className="rounded-sm bg-green-700 px-3 py-1.5 text-white disabled:opacity-40">
                    ▶
                  </button>
                ) : (
                  <button
                    title="Stop Debugging"
                    aria-label="Stop Debugging"
                    disabled={debug.pending || debug.session?.state === SessionState.TERMINATING}
                    onClick={debug.stop}
                    className="rounded-sm bg-red-700 px-3 py-1.5 text-white disabled:opacity-40">
                    ■
                  </button>
                )}
              </div>
              {debug.selectedConfiguration && !debug.selectedConfiguration.valid && (
                <ul className="text-amber-300">
                  {debug.selectedConfiguration.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              )}
              {debug.session && (
                <div aria-live="polite" className="flex justify-between text-muted-foreground">
                  <span className="capitalize">{debug.session.state.replaceAll("_", " ")}</span>
                  {debug.session.exitCode != null && <span>Exit {debug.session.exitCode}</span>}
                </div>
              )}
            </>
          )}
          {list?.diagnostics.map((diagnostic) => (
            <p key={`${diagnostic.path}:${diagnostic.message}`} className="text-amber-300">
              {diagnostic.message}
            </p>
          ))}
          {(error || debug.session?.error) && (
            <div role="alert" className="rounded border border-red-800 bg-red-950/40 p-2 text-red-300">
              {debug.session?.error ?? error?.message}
            </div>
          )}
        </div>
      </details>
      <details open className="border-b border-border">
        <summary className="cursor-pointer select-none px-3 py-2 text-[11px] font-semibold tracking-wide">
          CALL STACK
        </summary>
        {runtime.loading && (
          <p role="status" className="px-4 pb-2 text-muted-foreground">
            Loading {runtime.loading}…
          </p>
        )}
        {runtime.error && (
          <p role="alert" className="px-4 pb-2 text-red-300">
            {runtime.error}
          </p>
        )}
        {!runtime.threads.length ? (
          <p className="px-4 pb-3 text-muted-foreground">
            {debug.session?.state === SessionState.STOPPED ? "No threads" : "Not paused"}
          </p>
        ) : (
          <ul role="tree" className="px-2 pb-2">
            {runtime.threads.map((thread) => (
              <li role="treeitem" aria-expanded="true" key={thread.threadHandle}>
                <button className="w-full text-left" onClick={() => void runtime.stackLoad(thread.threadHandle)}>
                  ▾ {thread.name}
                </button>
                <ul role="group">
                  {runtime.frames.map((frame) => (
                    <li role="treeitem" key={frame.frameHandle}>
                      <button
                        className="w-full truncate pl-4 text-left"
                        onClick={() => {
                          void runtime.scopesLoad(frame.frameHandle);
                          if (frame.source.kind === "workspace" && frame.source.file_id)
                            void openEditorLocation({
                              workspaceId,
                              fileId: frame.source.file_id as FileId,
                              position: { line: frame.line, character: frame.column ?? 0 },
                            });
                          if (frame.source.kind === "generated" && frame.source.source_handle)
                            void runtime.sourceOpen(frame.source.source_handle, frame.source.name);
                        }}>
                        {frame.name}{" "}
                        <span className="text-muted-foreground">
                          {frame.source.file_id}:{frame.line + 1}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                {runtime.stackTruncated && (
                  <button
                    className="pl-4 text-muted-foreground"
                    disabled={runtime.loading === "stack"}
                    onClick={() => void runtime.stackLoad(thread.threadHandle, true)}>
                    Load more frames{runtime.totalFrames != null ? ` (${runtime.frames.length}/${runtime.totalFrames})` : ""}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </details>
      <details open className="border-b border-border">
        <summary className="cursor-pointer select-none px-3 py-2 text-[11px] font-semibold tracking-wide">
          VARIABLES
        </summary>
        {!runtime.scopes.length ? (
          <p className="px-4 pb-3 text-muted-foreground">Select a stack frame</p>
        ) : (
          <ul role="tree" className="px-2 pb-2">
            {runtime.scopes.map((scope) => (
              <li role="treeitem" key={scope.variablesHandle}>
                <button className="w-full text-left" onClick={() => void runtime.variablesLoad(scope.variablesHandle)}>
                  ▸ {scope.name}
                </button>
                {runtime.variables[scope.variablesHandle] && (
                  <ul role="group">
                    {runtime.variables[scope.variablesHandle].map((variable, index) => (
                      <VariableNode key={`${variable.name}:${index}`} variable={variable} />
                    ))}
                    {runtime.variableTruncated[scope.variablesHandle] && (
                      <li className="pl-4 text-muted-foreground">Results truncated</li>
                    )}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </details>
      <details open className="border-b border-border">
        <summary className="cursor-pointer select-none px-3 py-2 text-[11px] font-semibold tracking-wide">
          WATCH
        </summary>
        <ul className="px-2">
          {runtime.watches.map((watch) => (
            <li className="group flex gap-2" key={watch.id}>
              <input
                type="checkbox"
                checked={watch.autoRefresh}
                aria-label={`Automatically refresh watch ${watch.expression}`}
                title="Refresh automatically whenever execution stops"
                onChange={(event) => void runtime.watchAutoRefresh(watch.id, event.target.checked)}
              />
              <button
                title="Refresh watch; evaluation may have side effects"
                aria-label={`Refresh watch ${watch.expression}`}
                disabled={debug.session?.state !== SessionState.STOPPED}
                onClick={() => void runtime.watchRefresh(watch.id)}>
                ↻
              </button>
              <span className="min-w-0 flex-1 truncate">
                {watch.expression}:{" "}
                <span className={watch.error ? "text-red-300" : "text-muted-foreground"}>
                  {watch.error ?? watch.value ?? "Not evaluated"}
                </span>
              </span>
              <button aria-label={`Remove watch ${watch.expression}`} onClick={() => runtime.watchRemove(watch.id)}>
                ×
              </button>
            </li>
          ))}
        </ul>
        <form
          className="flex px-2 pb-2"
          onSubmit={(event) => {
            event.preventDefault();
            runtime.watchAdd(watchExpression);
            setWatchExpression("");
          }}>
          <label className="sr-only" htmlFor="debug-watch">
            Watch expression
          </label>
          <input
            id="debug-watch"
            className="min-w-0 flex-1 bg-background"
            value={watchExpression}
            onChange={(event) => setWatchExpression(event.target.value)}
            placeholder="Add watch expression"
          />
          <button>Add</button>
        </form>
      </details>
      <details open className="min-h-0 flex-1 border-b border-border">
        <summary className="cursor-pointer select-none px-3 py-2 text-[11px] font-semibold tracking-wide">
          DEBUG CONSOLE
        </summary>
        <pre
          aria-label="Debug output"
          className="h-[calc(100%-34px)] overflow-auto whitespace-pre-wrap wrap-break-word px-4 pb-3 font-mono text-xs">
          {debug.session?.output.map((chunk) => chunk.output).join("") || "No debug output."}
        </pre>
        {evaluations.map((item, index) => (
          <div key={index} className={`px-4 font-mono text-xs ${item.unknown ? "text-amber-300" : item.error ? "text-red-300" : ""}`}>
            <div>› {item.expression}</div>
            <div>{item.unknown ? `Outcome unknown: ${item.value}` : item.value}</div>
          </div>
        ))}
        <form
          className="flex gap-1 px-2 pb-2"
          onSubmit={async (event) => {
            event.preventDefault();
            const input = expression.trim();
            if (!input) return;
            setExpression("");
            try {
              const result = await runtime.evaluate(input, runtime.frames[0]?.frameHandle);
              appendEvaluation({ expression: input, value: result.value });
            } catch (error) {
              const value = String(error);
              appendEvaluation({
                expression: input,
                value,
                error: true,
                unknown: value.includes("debug_request_timeout"),
              });
            }
          }}>
          <label htmlFor="debug-expression" className="sr-only">
            Evaluate expression; expressions may have side effects
          </label>
          <input
            id="debug-expression"
            title="Expressions may execute code and have side effects"
            disabled={debug.session?.state !== SessionState.STOPPED}
            value={expression}
            onChange={(event) => setExpression(event.target.value)}
            placeholder="Evaluate (may have side effects)"
            className="min-w-0 flex-1 border border-border bg-background px-2"
          />
          <button disabled={debug.session?.state !== SessionState.STOPPED} type="submit">
            Run
          </button>
        </form>
      </details>
      <details open className="border-b border-border">
        <summary className="cursor-pointer select-none px-3 py-2 text-[11px] font-semibold tracking-wide">
          BREAKPOINTS
        </summary>
        {!breakpoints.length ? (
          <p className="px-4 pb-4 text-muted-foreground">No breakpoints set</p>
        ) : (
          <ul aria-label="Breakpoints" className="space-y-1 px-2 pb-3">
            {breakpoints.map((b) => (
              (() => {
                const verification = debug.session?.verifiedBreakpoints.find(
                  (item) => item.requestedBreakpointId === b.breakpointId,
                );
                const moved = verification?.resolvedLine != null && verification.resolvedLine !== b.line;
                const state = !b.enabled
                  ? "disabled"
                  : verification?.verified
                    ? moved ? "moved" : "verified"
                    : verification
                      ? "rejected"
                      : "unverified";
                return (
              <li
                key={b.breakpointId}
                className="group flex min-w-0 items-center gap-2 rounded px-1 py-1 hover:bg-muted">
                <input
                  aria-label={`${b.enabled ? "Disable" : "Enable"} breakpoint at ${b.fileId}:${b.line + 1}`}
                  type="checkbox"
                  checked={b.enabled}
                  onChange={() => void updateBreakpoint(workspaceId, b, { enabled: !b.enabled })}
                />
                <button
                  type="button"
                  title={b.fileId}
                  className="min-w-0 flex-1 truncate text-left"
                  onClick={() =>
                    void openEditorLocation({
                      workspaceId,
                      fileId: b.fileId as FileId,
                      position: { line: b.line, character: b.column ?? 0 },
                    })
                  }
                  aria-label={`Breakpoint ${b.fileId} line ${b.line + 1}`}>
                  <span className="font-medium">{b.fileId.split("/").pop()}</span>{" "}
                  <span className="text-muted-foreground">{b.line + 1}</span>
                  <span className="ml-1 text-[10px] uppercase text-muted-foreground">
                    {state}{moved ? ` → ${verification!.resolvedLine! + 1}` : ""}
                  </span>
                  {(b.condition || b.hitCondition || b.logMessage) && (
                    <span className="ml-1" title="Conditional breakpoint">
                      ◆
                    </span>
                  )}
                </button>
                {verification?.message && <span title={verification.message} aria-label={verification.message}>ⓘ</span>}
                <button
                  type="button"
                  title="Edit breakpoint condition"
                  aria-label={`Edit condition for breakpoint at ${b.fileId}:${b.line + 1}`}
                  onClick={() => editBreakpoint(b, "condition")}>
                  C
                </button>
                <button
                  type="button"
                  title="Edit breakpoint hit count"
                  aria-label={`Edit hit count for breakpoint at ${b.fileId}:${b.line + 1}`}
                  onClick={() => editBreakpoint(b, "hitCondition")}>
                  H
                </button>
                <button
                  type="button"
                  title="Edit breakpoint log message"
                  aria-label={`Edit log message for breakpoint at ${b.fileId}:${b.line + 1}`}
                  onClick={() => editBreakpoint(b, "logMessage")}>
                  L
                </button>
                <button
                  type="button"
                  aria-label={`Remove breakpoint at ${b.fileId}:${b.line + 1}`}
                  onClick={() => void removeBreakpoint(workspaceId, b)}
                  className="opacity-0 group-hover:opacity-100 focus:opacity-100">
                  ×
                </button>
              </li>
                );
              })()
            ))}
          </ul>
        )}
      </details>
      {breakpointEditor && (() => {
        const breakpoint = breakpoints.find((item) => item.breakpointId === breakpointEditor.breakpointId);
        if (!breakpoint) return null;
        const label = breakpointEditor.field === "condition"
          ? "Breakpoint condition"
          : breakpointEditor.field === "hitCondition"
            ? "Hit count condition"
            : "Log message";
        return (
          <div role="dialog" aria-modal="true" aria-labelledby="breakpoint-editor-title" className="absolute inset-x-2 bottom-2 z-20 rounded border border-border bg-background p-3 shadow-xl">
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                setBreakpointEditorError(undefined);
                try {
                  await updateBreakpoint(workspaceId, breakpoint, {
                    [breakpointEditor.field]: breakpointEditor.value.trim() || null,
                  });
                  setBreakpointEditor(undefined);
                } catch (error) {
                  setBreakpointEditorError(String(error));
                }
              }}>
              <h3 id="breakpoint-editor-title" className="mb-2 font-semibold">{label}</h3>
              <p className="mb-2 truncate text-xs text-muted-foreground" title={breakpoint.fileId}>
                {breakpoint.fileId}:{breakpoint.line + 1}
              </p>
              <label className="sr-only" htmlFor="breakpoint-editor-value">{label}</label>
              <input
                id="breakpoint-editor-value"
                autoFocus
                value={breakpointEditor.value}
                onChange={(event) => setBreakpointEditor({ ...breakpointEditor, value: event.target.value })}
                className="w-full rounded border border-border bg-background px-2 py-1"
              />
              {breakpointEditorError && <p role="alert" className="mt-2 text-red-300">{breakpointEditorError}</p>}
              <div className="mt-3 flex justify-end gap-2">
                <button type="button" onClick={() => setBreakpointEditor(undefined)}>Cancel</button>
                <button type="submit" className="rounded bg-primary px-2 py-1 text-primary-foreground">Save</button>
              </div>
            </form>
          </div>
        );
      })()}
    </div>
  );
}
