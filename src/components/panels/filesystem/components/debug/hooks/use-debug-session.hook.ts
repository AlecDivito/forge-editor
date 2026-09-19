import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getSessionQueryKey } from "@/lib/generated/@tanstack/react-query.gen";
import { socket } from "@/lib/ws/connection";
import { WorkspaceId } from "@/lib/ws/messages";
import { isTerminalDebugState } from "./debug-session-state";
import useCreateDebugSession from "./use-create-debug-session.hook";
import useDebugConfigurations from "./use-debug-configurations.hook";
import useDebugSessionCache from "./use-debug-session-cache.hook";
import useStopDebugSession from "./use-stop-debug-session.hook";

/** Composes focused query and mutation hooks for the DebugView. */
export default function useDebugSession(workspaceId: WorkspaceId) {
  const [sessionId, setSessionId] = useState<string>();
  const queryClient = useQueryClient();
  const configurations = useDebugConfigurations(workspaceId);
  const sessionQuery = useDebugSessionCache(workspaceId, sessionId);
  const createMutation = useCreateDebugSession(
    workspaceId,
    (session) => setSessionId(session.sessionId),
    () => void configurations.query.refetch(),
  );
  const stopMutation = useStopDebugSession(workspaceId);

  useEffect(() => setSessionId(undefined), [workspaceId]);

  useEffect(() => {
    if (!sessionId) return;
    const queryKey = getSessionQueryKey({ path: { workspace_id: workspaceId, session_id: sessionId } });
    const subscribe = () =>
      socket.send({ kind: "DebugSessionSubscribe", workspace_id: workspaceId, session_id: sessionId });
    const unsubscribeMessage = socket.subscribe((message) => {
      if (
        message.kind !== "DebugSessionUpdated" ||
        message.workspace_id !== workspaceId ||
        message.session_id !== sessionId
      )
        return;
      queryClient.setQueryData(queryKey, message.session);
    });
    const unsubscribeConnection = socket.subscribeConnection(subscribe);
    subscribe();
    return () => {
      unsubscribeMessage();
      unsubscribeConnection();
    };
  }, [queryClient, sessionId, workspaceId]);

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
  }, [
    configurations.query.data?.revision,
    configurations.selectedConfigurationId,
    createMutation,
    pending,
    workspaceId,
  ]);

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
