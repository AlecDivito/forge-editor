"use client";

import { socket } from "@/lib/ws/connection";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { ReactNode, useEffect, useState } from "react";
import { apiOrigin } from "@/lib/transport";
import { EnvironmentSnapshot, useWorkspaceStore, WorkspaceProvider } from "@/lib/workspaces";
import { isGitQueryForWorkspace } from "@/components/panels/filesystem/components/git/hooks/use-invalidate-git.hook";
import { WorkspaceId } from "@/lib/ws/messages";

interface Props {
  children: ReactNode;
  initialEnvironment?: EnvironmentSnapshot;
}

export default function Providers({ children, initialEnvironment }: Props) {
  return (
    <WorkspaceProvider initialEnvironment={initialEnvironment}>
      <WorkspaceAwareProviders>{children}</WorkspaceAwareProviders>
    </WorkspaceProvider>
  );
}

function WorkspaceAwareProviders({ children }: Pick<Props, "children">) {
  const [queryClient] = useState(() => new QueryClient());
  const status = useWorkspaceStore((state) => state.status);
  const error = useWorkspaceStore((state) => state.error);
  const refresh = useWorkspaceStore((state) => state.refresh);
  const snapshot = useWorkspaceStore((state) => state.snapshot);

  useEffect(() => {
    // SocketManager converts http(s) origins to ws(s), while keeping the
    // endpoint deployable behind the current browser origin or API host.
    if (status !== "ready") return;
    socket.connect(`${apiOrigin()}/ws/editor`, `token`);
    // deliberately no disconnect() in cleanup — this component can
    // remount (Strict Mode, route changes) without tearing down a
    // connection that other parts of the app still depend on. The
    // singleton owns its own lifecycle.
  }, [status]);

  useEffect(() => {
    const gitInvalidationTimers = new Map<string, ReturnType<typeof setTimeout>>();
    function scheduleGitInvalidation(workspaceId: string) {
      const current = gitInvalidationTimers.get(workspaceId);
      if (current) clearTimeout(current);
      gitInvalidationTimers.set(
        workspaceId,
        setTimeout(() => {
          gitInvalidationTimers.delete(workspaceId);
          void queryClient.invalidateQueries({
            predicate: (query) => isGitQueryForWorkspace(query.queryKey, workspaceId as WorkspaceId),
          });
        }, 200),
      );
    }
    const unsubscribe = socket.subscribe((message) => {
      if (
        message.kind === "Hello" &&
        snapshot &&
        (message.environment_id !== snapshot.environment.id || message.schema_version !== snapshot.schema_version)
      )
        void refresh();
      if (message.kind === "FsChanged") {
        // Native watchers commonly emit several events for one shell command.
        // React Query coalesces these invalidations and refetches active trees.
        void queryClient.invalidateQueries({
          predicate: (query) => {
            const key = query.queryKey[0] as { _id?: string; query?: { workspace_id?: string } };
            return key._id === "listFiles" && key.query?.workspace_id === message.workspace_id;
          },
        });
      }
      if (message.kind === "GitChanged") {
        scheduleGitInvalidation(message.workspace_id);
      }
    });
    return () => {
      unsubscribe();
      gitInvalidationTimers.forEach(clearTimeout);
    };
  }, [queryClient, refresh, snapshot]);

  if (status === "idle" || status === "loading")
    return <main className="grid h-screen place-items-center">Loading workspaces…</main>;
  if (status === "error")
    return <main className="grid h-screen place-items-center">Workspace configuration error: {error}</main>;

  return (
    <QueryClientProvider client={queryClient}>
      <ReactQueryDevtools />
      {children}
    </QueryClientProvider>
  );
}
