import { listFilesOptions, listFilesQueryKey } from "@/lib/generated/@tanstack/react-query.gen"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useCallback } from "react"

interface Props {
    path: string,
    enabled?: boolean
}

export const DEFAULT_LIST_FILE_PAGINATION = {
    page: 0,
    size: 10000
}

export default function useListFiles({ path, enabled = true }: Props) {
    return useQuery({
        ...listFilesOptions({
            query: {
                path,
                ...DEFAULT_LIST_FILE_PAGINATION
            }
        }),
        enabled
    })
}

export function useInvalidateAllFileLists() {
    const queryClient = useQueryClient()
    return useCallback(() => {
        queryClient.invalidateQueries({
            predicate: (query) => (query.queryKey[0] as { _id?: string })?.['_id'] === listFilesQueryKey({ query: { path: '/' } })[0]?.['_id']
        })
    }, [])
}
