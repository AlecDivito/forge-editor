import { FsSearchQuery } from "@/lib/generated"
import { searchFilesOptions, searchFilesQueryKey } from "@/lib/generated/@tanstack/react-query.gen"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useCallback, useState } from "react"

export default function useSearchFiles() {
    const queryClient = useQueryClient()
    const [query, setSearchState] = useState<FsSearchQuery | undefined>(undefined)
    const data = useQuery({
        ...searchFilesOptions({
            query: query!
        }),
        enabled: !!query,
    })

    const clearData = useCallback(() => {
        if (query) {
            setSearchState(undefined);
            queryClient.resetQueries({ queryKey: searchFilesQueryKey({ query }) })
        }
    }, [query, queryClient])

    return { ...data, clearData, setSearchState, query }
}
