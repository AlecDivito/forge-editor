import { FsSearchQuery } from "@/lib/generated"
import { searchFilesOptions, searchFilesQueryKey } from "@/lib/generated/@tanstack/react-query.gen"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useCallback, useState } from "react"
import { WorkspaceId } from "@/lib/ws/messages"

export default function useSearchFiles(workspaceId: WorkspaceId) {
    const queryClient = useQueryClient()
    const [query, setSearchState] = useState<(FsSearchQuery & { workspace_id?: string }) | undefined>(undefined)
    const data = useQuery({
        ...searchFilesOptions({
            query: query!
        }),
        enabled: !!query,
    })

    const clearData = useCallback(() => {
        if (query) {
            setSearchState(undefined);
            queryClient.resetQueries({ queryKey: searchFilesQueryKey({ query: { ...query, workspace_id: workspaceId } }) })
        }
    }, [query, queryClient, workspaceId])

    return { ...data, clearData, setSearchState, query }
}
