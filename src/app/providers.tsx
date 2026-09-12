'use client'

import { socket } from "@/lib/ws/connection"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { ReactNode, useEffect, useState } from "react"
import { apiOrigin } from "@/lib/transport"
import { EnvironmentSnapshot, useWorkspaceStore, WorkspaceProvider } from "@/lib/workspaces"

interface Props {
    children: ReactNode
    initialEnvironment?: EnvironmentSnapshot
}

export default function Providers({ children, initialEnvironment }: Props) {
  return <WorkspaceProvider initialEnvironment={initialEnvironment}>
    <WorkspaceAwareProviders>{children}</WorkspaceAwareProviders>
  </WorkspaceProvider>
}

function WorkspaceAwareProviders({ children }: Pick<Props, "children">) {
    const [queryClient] = useState(() => new QueryClient())
    const status = useWorkspaceStore((state) => state.status)
    const error = useWorkspaceStore((state) => state.error)
    const refresh = useWorkspaceStore((state) => state.refresh)
    const snapshot = useWorkspaceStore((state) => state.snapshot)

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
      const unsubscribe = socket.subscribe((message) => {
      if (message.kind === "Hello" && snapshot && (message.environment_id !== snapshot.environment.id || message.schema_version !== snapshot.schema_version)) void refresh()
      })
      return () => { unsubscribe() }
    }, [refresh, snapshot])

    if (status === "idle" || status === "loading") return <main className="grid h-screen place-items-center">Loading workspaces…</main>
    if (status === "error") return <main className="grid h-screen place-items-center">Workspace configuration error: {error}</main>
    

    return <QueryClientProvider client={queryClient}>
        <ReactQueryDevtools />
        {children}
    </QueryClientProvider>
}
