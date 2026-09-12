import { listFilesOptions, listFilesQueryKey } from "@/lib/generated/@tanstack/react-query.gen"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useCallback } from "react"
import { WorkspaceId } from "@/lib/ws/messages"

interface Props {
    workspaceId: WorkspaceId,
    path: string,
    enabled?: boolean
}

export const DEFAULT_LIST_FILE_PAGINATION = {
    page: 0,
    size: 10000
}

export default function useListFiles({ workspaceId, path, enabled = true }: Props) {
    return useQuery({
        ...listFilesOptions({
            query: {
                workspace_id: workspaceId,
                path,
                ...DEFAULT_LIST_FILE_PAGINATION
            }
        }),
        enabled
    })
}

export function useInvalidateAllFileLists(workspaceId: WorkspaceId) {
    const queryClient = useQueryClient()
    return useCallback(() => {
        queryClient.invalidateQueries({
            predicate: (query) => {
                const key = query.queryKey[0] as { _id?: string, query?: { workspace_id?: string } }
                return key._id === 'listFiles' && key.query?.workspace_id === workspaceId
            }
        })
    }, [queryClient, workspaceId])
}
