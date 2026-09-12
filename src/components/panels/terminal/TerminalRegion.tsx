"use client";
import { IGridviewPanelProps } from "dockview-react";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Plus, RotateCcw, Square, Trash2, X, ChevronsDown } from "lucide-react";
import { selectedWorkspace, useWorkspaceStore } from "@/lib/workspaces";
import { TerminalView } from "./TerminalView";
import { TerminalSession, terminalRegistry } from "./terminal.registry";

export default function TerminalRegion({ api }: IGridviewPanelProps) {
  const sessions = useSyncExternalStore(
    terminalRegistry.subscribe,
    terminalRegistry.getSnapshot,
    terminalRegistry.getSnapshot,
  );
  const workspace = useWorkspaceStore(selectedWorkspace);
  const workspaces = useWorkspaceStore((state) => state.snapshot?.workspaces ?? []);
  const [activeKey, setActiveKey] = useState<string>();
  const [focusToken, setFocusToken] = useState(0);
  const active = useMemo(
    () => sessions.find((session) => session.key === activeKey) ?? sessions[0],
    [activeKey, sessions],
  );
  useEffect(() => {
    if (active && active.key !== activeKey) setActiveKey(active.key);
  }, [active, activeKey]);
  const create = useCallback(
    async (source?: TerminalSession) => {
      const workspaceId = source?.workspaceId ?? workspace?.id;
      if (!workspaceId) return;
      try {
        const created = await terminalRegistry.create(workspaceId, source?.profileId);
        setActiveKey(created.key);
        setFocusToken((v) => v + 1);
      } catch {}
    },
    [workspace],
  );
  const close = useCallback(async (session: TerminalSession) => {
    if (
      (session.status === "running" || session.status === "creating") &&
      !window.confirm(`Terminate ${session.title}?`)
    )
      return;
    if (session.status === "running") await terminalRegistry.terminate(session).catch(() => undefined);
    terminalRegistry.remove(session);
  }, []);
  const workspaceName = (session: TerminalSession) =>
    workspaces.find(({ id }) => id === session.workspaceId)?.name ?? session.workspaceId;
  return (
    <section
      className="terminal-panel flex h-full min-h-0 flex-col bg-background text-foreground"
      aria-label="Terminal panel">
      <header className="flex h-9 shrink-0 items-center border-b border-border bg-card">
        <div className="flex min-w-0 flex-1 overflow-x-auto">
          {sessions.map((session) => (
            <button
              key={session.key}
              onClick={() => {
                setActiveKey(session.key);
                setFocusToken((v) => v + 1);
              }}
              onDoubleClick={() => {
                const title = window.prompt("Terminal name", session.title);
                if (title) terminalRegistry.rename(session, title);
              }}
              className={`group flex h-9 items-center gap-2 border-r border-border px-3 text-xs transition-colors ${session.key === active?.key ? "border-t-2 border-t-primary bg-background text-foreground" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"}`}>
              <span
                className={`h-2 w-2 rounded-full ${session.status === "running" ? "bg-primary" : session.status === "error" || session.status === "disconnected" ? "bg-destructive" : "bg-muted-foreground"}`}
              />
              <span className="max-w-40 truncate">
                {session.title} · {workspaceName(session)}
              </span>
              <X
                size={13}
                className="opacity-0 group-hover:opacity-100"
                onClick={(event) => {
                  event.stopPropagation();
                  void close(session);
                }}
              />
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 px-2">
          <Tool label="New terminal" onClick={() => void create()}>
            <Plus size={15} />
          </Tool>
          <Tool
            label="Clear"
            disabled={!active}
            onClick={() => {
              if (active) terminalRegistry.clear(active);
            }}>
            <Trash2 size={14} />
          </Tool>
          <Tool
            label="Restart"
            disabled={!active}
            onClick={() => {
              if (active)
                void terminalRegistry
                  .terminate(active)
                  .catch(() => undefined)
                  .then(() => {
                    terminalRegistry.remove(active);
                    return create(active);
                  });
            }}>
            <RotateCcw size={14} />
          </Tool>
          <Tool
            label="Kill terminal"
            disabled={!active || active.status !== "running"}
            onClick={() => active && void terminalRegistry.terminate(active)}>
            <Square size={13} />
          </Tool>
          <Tool label="Hide terminal" onClick={() => api.setVisible(false)}>
            <ChevronsDown size={15} />
          </Tool>
        </div>
      </header>
      <div className="min-h-0 flex-1">
        {active ? (
          <TerminalView key={active.key} session={active} focusToken={focusToken} />
        ) : (
          <div className="grid h-full place-items-center text-sm text-muted-foreground">
            <button
              className="rounded-md border border-border px-3 py-1.5 text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              onClick={() => void create()}>
              Create a terminal
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function Tool({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50">
      {children}
    </button>
  );
}
