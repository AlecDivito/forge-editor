import { useCallback, useEffect, useState } from "react";
import { WorkspaceId } from "@/lib/ws/messages";
import { isTerminalDebugState } from "./debug-session-state";
import useCreateDebugSession from "./use-create-debug-session.hook";
import useDebugConfigurations from "./use-debug-configurations.hook";
import useDebugSessionQuery from "./use-debug-session-query.hook";
import useStopDebugSession from "./use-stop-debug-session.hook";

/** Composes focused query and mutation hooks for the DebugView. */
export default function useDebugSession(workspaceId: WorkspaceId) {
  const [sessionId, setSessionId] = useState<string>();
  const configurations = useDebugConfigurations(workspaceId);
  const sessionQuery = useDebugSessionQuery(workspaceId, sessionId);
  const createMutation = useCreateDebugSession(
    workspaceId,
    (session) => setSessionId(session.sessionId),
    () => void configurations.query.refetch(),
  );
  const stopMutation = useStopDebugSession(workspaceId);

  useEffect(() => setSessionId(undefined), [workspaceId]);

  const pending = createMutation.isPending || stopMutation.isPending;
  const start = useCallback(() => {
    const revision = configurations.query.data?.revision;
    if (!configurations.selectedConfigurationId || !revision || pending) return;
    createMutation.mutate({
      path: { workspace_id: workspaceId },
      body: {
        configurationId: configurations.selectedConfigurationId,
        configurationRevision: revision,
      },
    });
  }, [configurations.query.data?.revision, configurations.selectedConfigurationId, createMutation, pending, workspaceId]);

  const stop = useCallback(() => {
    if (!sessionId || pending) return;
    stopMutation.mutate({ path: { workspace_id: workspaceId, session_id: sessionId } });
  }, [pending, sessionId, stopMutation, workspaceId]);

  return {
    active: !!sessionQuery.data && !isTerminalDebugState(sessionQuery.data.state),
    configurationsQuery: configurations.query,
    createMutation,
    pending,
    selectedConfiguration: configurations.selectedConfiguration,
    selectedConfigurationId: configurations.selectedConfigurationId,
    session: sessionQuery.data,
    sessionQuery,
    setSelectedConfigurationId: configurations.setSelectedConfigurationId,
    start,
    stop,
    stopMutation,
  };
}
