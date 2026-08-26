import { FsSearchQuery } from "@/lib/generated"
import { searchFilesOptions } from "@/lib/generated/@tanstack/react-query.gen"
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

export default function useSearchFiles() {
    const [query, setSearchState] = useState<FsSearchQuery | undefined>(undefined)
    const data = useQuery({
        ...searchFilesOptions({
            query: query!
        }),
        enabled: !!query,
    })

    return { setSearchState, ...data}
}
