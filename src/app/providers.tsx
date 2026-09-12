'use client'

import { socket } from "@/lib/ws/connection"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { ReactNode, useEffect } from "react"

interface Props {
    children: ReactNode
}

export default function Providers({ children }: Props) {
    const queryClient = new QueryClient()

    useEffect(() => {
        // SocketManager converts http(s) origins to ws(s), while keeping the
        // endpoint deployable behind the current browser origin or API host.
        const apiHost = process.env.NEXT_PUBLIC_API_HOST || window.location.origin;
        socket.connect(`${apiHost}/ws/editor`, `token`);
        // deliberately no disconnect() in cleanup — this component can
        // remount (Strict Mode, route changes) without tearing down a
        // connection that other parts of the app still depend on. The
        // singleton owns its own lifecycle.
      }, []);
    

    return <QueryClientProvider client={queryClient}>
        <ReactQueryDevtools />
        {children}
    </QueryClientProvider>
}
